// One-time deployment cleanup. Run only with the old API stopped; never during migration rehearsal.
const PREFIX = "skill-repositories/"

async function retireCloudSkills({ db, env, createStorage, rehearsal = false, report = () => undefined }) {
  const { rows } = await db.query('SELECT to_regclass(\'public."SkillRepository"\') AS present')
  if (!rows[0].present) return { skipped: true, deleted: 0 }

  if (rehearsal) {
    const database = await db.query("SELECT current_database() AS name")
    if (!/^synapse_preflight_[A-Za-z0-9_]+$/.test(database.rows[0].name)) {
      throw new Error("Migration rehearsal is restricted to a deployment preflight database.")
    }
    await clearObjectReferences(db)
    return { skipped: false, rehearsal: true, deleted: 0 }
  }

  const settings = ["SECRET_ID", "SECRET_KEY", "BUCKET", "REGION"].map((key) => env[`SKILL_REPOSITORY_COS_${key}`])
  const references = await db.query(`SELECT EXISTS (
    SELECT 1 FROM "SkillRepositoryFile" WHERE "storageKey" IS NOT NULL
    UNION ALL SELECT 1 FROM "SkillRepositoryInstallSession"
    UNION ALL SELECT 1 FROM "SkillRepositoryObjectCleanupTask"
  ) AS required`)
  if (!settings.some(Boolean) && !references.rows[0].required) return { skipped: true, deleted: 0 }
  if (!settings.every(Boolean)) throw new Error("Retiring cloud Skills requires the complete legacy SKILL_REPOSITORY_COS_* configuration.")
  const [secretId, secretKey, bucket, region] = settings
  if (["DRIVE", "PLATFORM_MEDIA", "BACKUP", "MAIL", "SKILL_HUB"].some((domain) => env[`${domain}_COS_BUCKET`]?.trim().toLowerCase() === bucket.trim().toLowerCase())) {
    throw new Error("Refusing cloud Skill cleanup in a shared storage bucket.")
  }
  const storage = createStorage({ SecretId: secretId, SecretKey: secretKey, Timeout: 30_000 })
  const call = (method, input) => new Promise((resolve, reject) => {
    storage[method]({ Bucket: bucket, Region: region, ...input }, (error, result) => error ? reject(error) : resolve(result))
  })
  const versioning = await call("getBucketVersioning", {})
  const versioned = ["Enabled", "Suspended"].includes(versioning.VersioningConfiguration?.Status)
  let deleted = 0
  // Drain the first page repeatedly: no offset/marker can skip objects as preceding pages disappear.
  for (;;) {
    const page = await call(versioned ? "listObjectVersions" : "getBucket", { Prefix: PREFIX, MaxKeys: 1000 })
    const objects = versioned
      ? [...(page.Versions ?? []), ...(page.DeleteMarkers ?? [])].map(({ Key, VersionId }) => ({ Key, VersionId }))
      : (page.Contents ?? []).map(({ Key }) => ({ Key }))
    if (!objects.length) {
      if (String(page.IsTruncated) === "true") throw new Error("Cloud Skill cleanup returned a truncated empty page.")
      break
    }
    if (objects.some(({ Key, VersionId }) => typeof Key !== "string" || !Key.startsWith(PREFIX) || versioned && typeof VersionId !== "string")) throw new Error("Storage returned an object outside the retired cloud Skill prefix.")
    const result = await call("deleteMultipleObject", { Objects: objects, Quiet: false })
    if (result.Error?.length) throw new Error("Cloud Skill object deletion failed; database metadata was retained for retry.")
    deleted += objects.length
    report({ deleted })
  }
  // Release the migration guard only after every live file, export and orphan has been deleted.
  await clearObjectReferences(db)
  return { skipped: false, deleted }
}

async function clearObjectReferences(db) {
  await db.query("BEGIN")
  try {
    await db.query('UPDATE "SkillRepositoryFile" SET "storageKey" = NULL WHERE "storageKey" IS NOT NULL')
    await db.query('DELETE FROM "SkillRepositoryInstallSession"')
    await db.query('DELETE FROM "SkillRepositoryObjectCleanupTask"')
    await db.query("COMMIT")
  } catch (error) {
    await db.query("ROLLBACK")
    throw error
  }
}

module.exports = { retireCloudSkills }

if (require.main === module) {
  const { Client } = require("pg")
  const COS = require("cos-nodejs-sdk-v5")
  const db = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 })
  const deadline = setTimeout(() => {
    process.stderr.write("Cloud Skill retirement exceeded the 10 minute deployment deadline. Retry before migrating.\n")
    process.exit(1)
  }, 600_000)
  ;(async () => {
    try {
      if (!process.argv.includes("--execute-deployment") && !process.argv.includes("--rehearsal")) {
        throw new Error("Cloud Skill retirement may only run explicitly during deployment.")
      }
      await db.connect()
      const result = await retireCloudSkills({ db, env: process.env, rehearsal: process.argv.includes("--rehearsal"), createStorage: (config) => new COS(config), report: (progress) => process.stdout.write(`Retired cloud Skill objects: ${progress.deleted}\n`) })
      process.stdout.write(`Cloud Skill retirement: ${JSON.stringify(result)}\n`)
    } finally {
      clearTimeout(deadline)
      await db.end()
    }
  })().catch((error) => {
    // Do not print connection strings, credentials or provider request details.
    process.stderr.write(`Cloud Skill retirement failed (${error?.code ?? "cleanup_error"}); migration must not proceed.\n`)
    process.exitCode = 1
  })
}
