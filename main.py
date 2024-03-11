import json
import platform

from aiortc import RTCPeerConnection, RTCSessionDescription
from aiortc.contrib.media import MediaPlayer, MediaRelay
from aiortc.rtcrtpsender import RTCRtpSender
from fastapi import FastAPI
from fastapi.responses import Response
from pydantic import BaseModel
import uvicorn


app = FastAPI()  # fast api app
pcs = set()  # peer connections
relay = None
webcam = None


class Offer(BaseModel):
    sdp: str
    type: str


def create_local_tracks():
    global relay, webcam

    options = {"framerate": "30", "video_size": "640x480"}
    if relay is None:
        if platform.system() == "Darwin":
            webcam = MediaPlayer(
                "default:none",
                format="avfoundation",
                options=options
            )
        elif platform.system() == "Windows":
            webcam = MediaPlayer(
                "video=Integrated Camera",
                format="dshow",
                options=options
            )
        else:
            webcam = MediaPlayer(
                "/dev/video0",
                format="v4l2",
                options=options
            )
        relay = MediaRelay()
    if webcam:
        return None, relay.subscribe(webcam.video)
    raise ValueError("Webcam and Relay is None!")


@app.get("/")
async def root():
    with open("./static/index.html", 'r') as rf:
        index_html = rf.read()
    return Response(
        content=index_html,
        media_type="text/html"
    )


@app.get("/client.js")
async def client_js():
    with open("./static/client.js", 'r') as rf:
        client_js = rf.read()
    return Response(
        content=client_js,
        media_type="application/javascript"
    )


@app.post("/offer")
async def offer(offer: Offer):
    offer_conf = RTCSessionDescription(sdp=offer.sdp, type=offer.type)
    pc = RTCPeerConnection()

    pcs.add(pc)

    @pc.on("connectionstatechange")
    async def on_connectionstatechange():
        print("Connection state is %s" % pc.connectionState)
        if pc.connectionState == "failed":
            await pc.close()
            pcs.discard(pc)

    await pc.setRemoteDescription(offer_conf)

    answer = await pc.createAnswer()
    if answer:
        await pc.setLocalDescription(answer)

    return Response(
        content=Offer(
            sdp=pc.localDescription.sdp,
            type=pc.localDescription.type
        ).model_dump_json(),
        media_type="application/json"
    )

if __name__ == "__main__":
    running_app = uvicorn.run(
        app=app,
        host="localhost",
        port=8000,
    )
