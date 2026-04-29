# Synapse Server

NestJS + Prisma backend for license activation and the admin UI.

## Local Docker

Generate an Ed25519 key pair:

```bash
node -e "const {generateKeyPairSync}=require('crypto'); const {privateKey,publicKey}=generateKeyPairSync('ed25519'); console.log('LICENSE_PRIVATE_KEY='+JSON.stringify(privateKey.export({type:'pkcs8',format:'pem'}))); console.log('LICENSE_PUBLIC_KEY='+JSON.stringify(publicKey.export({type:'spki',format:'pem'})));"
```

Create `server/.env` from `server/.env.example`, then start:

```bash
pnpm server:docker:up
```

The admin UI is served at `http://localhost:3000/admin`. Postgres data is stored in the Docker volume `synapse-postgres`.

## Local Without Docker

Run PostgreSQL yourself, set `DATABASE_URL` and the other values from `server/.env.example`, then:

```bash
pnpm --filter @synapse/server prisma:migrate
pnpm server:dev
```

## Move Data

Export from local Docker:

```bash
docker compose -f server/compose.yml exec postgres pg_dump -U synapse -d synapse -Fc -f /tmp/synapse.dump
docker compose -f server/compose.yml cp postgres:/tmp/synapse.dump ./synapse.dump
```

Restore on a server:

```bash
pg_restore --clean --if-exists --no-owner --dbname "$DATABASE_URL" ./synapse.dump
```

To sync server data back down, run `pg_dump` on the server and restore it into local Postgres the same way. The desktop app only stores its signed offline lease locally; it does not sync the full server database.
