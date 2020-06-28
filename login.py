import requests
import json

def login():
    config_file = open('config.json', 'r').read()
    config = json.loads(config_file)

    issueToken = config['googleAuth']['issueToken']
    cookies = config['googleAuth']['cookies']
    apiKey = config['googleAuth']['apiKey']
    USER_AGENT_STRING = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/77.0.3865.120 Safari/537.36'
    NEST_API_HOSTNAME = 'https://home.nest.com'
    apiTimeout = 40 * 1000
    apiRetry = 15
    headers = {
        'Sec-Fetch-Mode': 'cors',
        'User-Agent': USER_AGENT_STRING,
        'X-Requested-With': 'XmlHttpRequest',
        'Referer': 'https://accounts.google.com/o/oauth2/iframe',
        'cookie': cookies,
    }

    r = requests.get(url=issueToken, headers=headers, timeout=apiTimeout)

    if r.status_code != 200:
        raise 'NOPe'

    accessToken = r.json()['access_token']

    data = {
        'embed_google_oauth_access_token': True,
        'expire_after': '3600s', # expire the access token in 1 hour
        'google_oauth_access_token': accessToken,
        'policy_id': 'authproxy-oauth-policy'
    }

    headers = {
        'Authorization': 'Bearer ' + accessToken,
        'User-Agent': USER_AGENT_STRING,
        'x-goog-api-key': apiKey,
        'Referer': NEST_API_HOSTNAME,
    }

    r = requests.post(url='https://nestauthproxyservice-pa.googleapis.com/v1/issue_jwt', data=data, headers=headers, timeout=apiTimeout)
    if r.status_code != 200:
        raise 'nOPE'

    return r.json()['jwt']