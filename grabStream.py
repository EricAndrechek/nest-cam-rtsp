from login import login
from requestMaker import send

if __name__ == "__main__":
    jwt = login()
    resp = send(jwt, 'https://webapi.camera.home.nest.com', '/api/cameras.get_owned_and_member_of_with_properties', 'GET', None, None)

    uuid = resp['items'][0]['uuid']
    stream_url = resp['items'][0]['direct_nexustalk_host']
    

