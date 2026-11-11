"""Use the installed BT ACME client and Tencent SDK without persisting DNS secrets in orders."""
import contextlib
import os
import sys


class TencentChallengeRecords:
    def __init__(self, client, request_factory, zone, suffix):
        if not suffix.endswith('.' + zone):
            raise ValueError('Tunnel DNS suffix must belong to the configured zone')
        self.client = client
        self.request_factory = request_factory
        self.zone = zone
        self.suffix = suffix
        self.records = []

    def create(self, domain, value):
        if domain.startswith('*.'):
            domain = domain[2:]
        if domain != self.suffix:
            raise ValueError('Unexpected ACME challenge domain')
        params = {'Domain': self.zone, 'SubDomain': '_acme-challenge.' + self.suffix[:-(len(self.zone) + 1)],
                  'RecordType': 'TXT', 'RecordLine': '默认', 'Value': value, 'TTL': 600}
        result = self.client.CreateRecord(self.request_factory('CreateRecord', params))
        self.records.append(result.RecordId)

    def cleanup(self):
        for record_id in list(self.records):
            self.client.DeleteRecord(self.request_factory('DeleteRecord', {'Domain': self.zone, 'RecordId': record_id}))
            self.records.remove(record_id)


def main():
    panel = os.environ.get('TUNNEL_BT_PANEL', '/www/server/panel')
    os.chdir(panel)
    sys.path[:0] = [panel, panel + '/class']
    with open(os.devnull, 'w') as quiet, contextlib.redirect_stdout(quiet), contextlib.redirect_stderr(quiet):
        import acme_v2
        from tencentcloud.common import credential
        from tencentcloud.dnspod.v20210323 import dnspod_client, models
        from tencentcloud.common.profile.client_profile import ClientProfile
        from tencentcloud.common.profile.http_profile import HttpProfile
        profile = ClientProfile()
        profile.httpProfile = HttpProfile()
        profile.httpProfile.endpoint = 'dnspod.tencentcloudapi.com'
        client = dnspod_client.DnspodClient(credential.Credential(os.environ['TUNNEL_DNS_SECRET_ID'], os.environ['TUNNEL_DNS_SECRET_KEY']), '', profile)
        def request_factory(action, params):
            request = getattr(models, action + 'Request')()
            import json
            request.from_json_string(json.dumps(params))
            return request
        provider = TencentChallengeRecords(client, request_factory, os.environ['TUNNEL_DNS_ZONE'], os.environ['TUNNEL_PUBLIC_DOMAIN'])
        class TunnelAcme(acme_v2.acme_v2):
            def create_dns_record(self, auth_to, domain, value):
                if auth_to != 'TencentCloudDns':
                    raise ValueError('Unexpected DNS provider')
                provider.create(domain, value)
            def remove_dns_record(self):
                provider.cleanup()
            def save_cert(self, cert, index):
                destination = os.environ['TUNNEL_CERT_CANDIDATE']
                for name, value in [('fullchain.pem', cert['cert'] + cert['root']), ('privkey.pem', cert['private_key'])]:
                    with open(destination + '/' + name, 'x') as output:
                        output.write(value)
                    os.chmod(destination + '/' + name, 0o600)
        try:
            result = TunnelAcme().apply_cert(['*.' + os.environ['TUNNEL_PUBLIC_DOMAIN']], auth_type='dns', auth_to='TencentCloudDns')
            if not result.get('status'):
                raise RuntimeError('ACME issuance failed')
        finally:
            provider.cleanup()


if __name__ == '__main__':
    try:
        main()
    except BaseException:
        sys.stderr.write('Tunnel ACME issuance/owned TXT cleanup failed; active certificate preserved.\n')
        sys.exit(1)
