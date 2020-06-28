import requests

USER_AGENT_STRING = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/77.0.3865.120 Safari/537.36'
NEST_API_HOSTNAME = 'https://home.nest.com'
CAMERA_API_HOSTNAME = 'https://webapi.camera.home.nest.com'
CAMERA_AUTH_COOKIE = 'website_2'

def send(accessToken, hostname, endpoint, method, type, data):
    headers = {
        'User-Agent': USER_AGENT_STRING,
        'Referer': NEST_API_HOSTNAME
    }

    if method == 'POST':
        headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=utf-8'
    
    if accessToken:
        headers['Cookie'] = 'user_token={}'.format(accessToken)

    url = hostname + endpoint
    r = requests.request(method=method, url=url, headers=headers, data=data)
    try:
        return r.json()
    except:
        return r.text
    