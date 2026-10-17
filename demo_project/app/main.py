from fastapi import FastAPI
from .services import fetch_user
from .models import User

app = FastAPI()

@app.get('/users/{user_id}')
async def user_route(user_id: int) -> User:
    return await fetch_user(user_id)
