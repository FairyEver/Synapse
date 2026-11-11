import { execFileSync } from "node:child_process"
import { describe, expect, it } from "vitest"
describe("Tencent DNS01 provider", () => {
  it("uses the restricted domain and deletes only TXT records created by this order", () => {
    const output = execFileSync("python3", ["-c", `
import importlib.util, json
spec=importlib.util.spec_from_file_location('provider','scripts/tunnel-acme.py')
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
class Fake:
 def __init__(self): self.created=[]; self.deleted=[]
 def CreateRecord(self, req):
  self.created.append(req); return type('Result', (), {'RecordId': 100+len(self.created)})()
 def DeleteRecord(self, req): self.deleted.append(req)
f=Fake(); p=m.TencentChallengeRecords(f, lambda action, value: value, 'd2.pub', 'tunnel.d2.pub')
p.create('tunnel.d2.pub','value-1'); p.create('tunnel.d2.pub','value-2')
try: p.create('another.d2.pub','wrong'); raise AssertionError('accepted unrelated domain')
except ValueError: pass
assert len(f.created)==2 and all(x['SubDomain']=='_acme-challenge.tunnel' and x['RecordType']=='TXT' for x in f.created)
p.cleanup(); p.cleanup()
assert f.deleted==[{'Domain':'d2.pub','RecordId':101},{'Domain':'d2.pub','RecordId':102}]
print('owned TXT cleanup verified')
`], { encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } })
    expect(output.trim()).toBe("owned TXT cleanup verified")
  })
})
