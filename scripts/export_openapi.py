import json
from app.main import create_app

app = create_app()
schema = app.openapi()
with open('openapi.json', 'w') as f:
    json.dump(schema, f, indent=2)
print('Wrote openapi.json')

