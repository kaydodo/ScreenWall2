import sys
content = open('D:/ScreenWall2/client/client.py', 'rb').read()
content = content.replace(b'CLIENT_VERSION = "1.7.5"', b'CLIENT_VERSION = "1.8.0"')
content = content.replace(b'hq_limit * 1.5', b'hq_limit * 2/3')
open('D:/ScreenWall2/client/client.py', 'wb').write(content)
print("Done")