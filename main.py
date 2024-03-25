import json
from enum import Enum
from typing import Any
import logging

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel

app = FastAPI()  # fast api app


# models, enums etc ###########################################################


class MessageSignal(Enum):
    USER_CONNECTED = "USER_CONNECTED"
    USER_DISCONNECTED = "USER_DISCONNECTED"
    NEW_ICE_CANDIDATE = "NEW_ICE_CANDIDATE"
    VIDEO_OFFER = "VIDEO_OFFER"
    VIDEO_ANSWER = "VIDEO_ANSWER"
    HANG_UP = "HANG_UP"


class Message(BaseModel):
    signal: MessageSignal
    content: Any


# user storage ################################################################


class User(BaseModel):
    id: str
    name: str


class UserStorage:
    def __init__(self) -> None:
        self.users: dict[str, User] = {}

    def create(self, id: str) -> User:
        created_user = User(
            id=id,
            name=f"Пользователь-{len(self.users.values()) + 1}"
        )
        self.users[id] = created_user
        return created_user

    def get(self, id: str | None = None) -> User | list[User]:
        if id:
            return self.users[id]
        return self.users.values()

    def delete(self, id: str) -> None:
        del self.users[id]


user_storage = UserStorage()


# con manager #################################################################


class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, WebSocket] = {}

    async def connect(self, websocket: WebSocket, id: str):
        await websocket.accept()
        self.active_connections.update({id: websocket})

    def disconnect(self, id: str):
        del self.active_connections[id]

    async def send_personal_message(self, message: str, id: str):
        await self.active_connections[id].send_text(message)

    async def broadcast(self, message: str):
        for connection in self.active_connections.values():
            await connection.send_text(message)


ws_connection_manager = ConnectionManager()


# routes ######################################################################


@app.get("/")
async def root():
    with open("./static/index.html", "r") as rf:
        index_html = rf.read()
    return HTMLResponse(index_html)


@app.get("/client.js")
async def client_js():
    with open("./static/client.js", "r") as rf:
        client_js = rf.read()
    return Response(content=client_js, media_type="application/javascript")


# web sockets #################################################################


@app.websocket("/ws/{user_uuid}")
async def websocket_chat(websocket: WebSocket, user_uuid: str):
    logging.info(f"User connected {user_uuid}")
    created_user = user_storage.create(user_uuid)
    await ws_connection_manager.connect(websocket, user_uuid)
    message = Message(
        signal=MessageSignal.USER_CONNECTED,
        content=[user for user in user_storage.get()]
    )
    await ws_connection_manager.broadcast(message.model_dump_json())

    try:
        while True:
            data = await websocket.receive_json()
            print("GET: ", data)

            if data["signal"] in (
                MessageSignal.VIDEO_OFFER.value,
                MessageSignal.NEW_ICE_CANDIDATE.value,
                MessageSignal.HANG_UP.value,
                MessageSignal.VIDEO_ANSWER.value,
            ):
                await ws_connection_manager.send_personal_message(
                    json.dumps(data),
                    data["content"]["userId"]
                )
            else:
                await ws_connection_manager.broadcast(
                    json.dumps(data)
                )

    except WebSocketDisconnect:
        user_storage.delete(user_uuid)
        ws_connection_manager.disconnect(user_uuid)
        message = Message(
            signal=MessageSignal.USER_DISCONNECTED,
            content=created_user
        )
        await ws_connection_manager.broadcast(message.model_dump_json())


# enter point #################################################################


if __name__ == "__main__":
    uvicorn.run(
        app="main:app",
        host="localhost",
        port=8000,
        reload=True,
    )
