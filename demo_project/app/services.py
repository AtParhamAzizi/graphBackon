import httpx
from .models import User

async def fetch_user(user_id: int) -> User:
    response = await httpx.AsyncClient().get(f'https://example.com/users/{user_id}')
    return User.from_payload(response.json())

def ambiguous(value):
    return helper(value)
