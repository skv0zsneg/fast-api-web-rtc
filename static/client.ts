// utils *********************************************************************/


function generateUUIDv4(): string {
    return "10000000-1000-4000-8000-100000000000".replace(
        /[018]/g, (c) => (parseInt(c) ^ crypto.getRandomValues(
            new Uint8Array(1))[0] & 15 >> parseInt(c) / 4
        ).toString(16)
    );
}


// interfaces & constance's **************************************************/


enum MessageSignal {
    USER_CONNECTED = "USER_CONNECTED",
    USER_DISCONNECTED = "USER_DISCONNECTED",
    NEW_ICE_CANDIDATE = "NEW_ICE_CANDIDATE",
    VIDEO_OFFER = "VIDEO_OFFER",
    VIDEO_ANSWER = "VIDEO_ANSWER",
    HANG_UP = "HANG_UP",
}

interface Message {
    signal: MessageSignal
    content: any
}

interface User {
    id: string
    name: string
}

interface NewIceCandidate {
    userId: string
    candidate: RTCIceCandidate | null
}

interface VideoSDP {
    userId: string
    sdp: RTCSessionDescription | null
}

interface HangUp {
    userId: string
}

var mediaConstraints = {
    audio: true, // We want an audio track
    video: true // ...and we want a video track
}

const CURRENT_USER_NAME = "It's you"
const USER_UUID = generateUUIDv4();
const ws = new WebSocket(`ws://localhost:8000/ws/${USER_UUID}`);

var myPeerConnection: RTCPeerConnection | null = null;
var targetUserId: string | null = null;


// ws actions ****************************************************************/


ws.onmessage = (event) => {
    let message: Message = JSON.parse(event.data);
    switch (message.signal) {

        case MessageSignal.USER_CONNECTED:
            clearUserList();
            for (let user of message.content) {
                addNewUser(user);
            }
            break;

        case MessageSignal.USER_DISCONNECTED:
            removeUser(message.content.id);
            break;

        case MessageSignal.VIDEO_OFFER:
            handleVideoOfferMsg(message.content);
            break;
        
        case MessageSignal.VIDEO_ANSWER:
            console.log("Got VIDEO_ANSWER");
            break;

        case MessageSignal.NEW_ICE_CANDIDATE:
            handleNewICECandidateMsg(message.content);
            break;

        case MessageSignal.HANG_UP:
            closeVideoCall();
            break;

        default:
            console.error(`IDK how to read this data ${message}`);
            break;
    }
};


// DOM actions ***************************************************************/


function getUserListElement() {
    let userList = document.getElementById('users');
    if (userList)
        return userList;
    throw new Error("Cannot get users list");
}

function getUserElement(userId: string) {
    let userElement = document.getElementById(userId);
    if (userElement)
        return userElement;
    throw new Error("Cannot get user");
}

function getHangupButtonElement() {
    let hangupButtonElement = document.getElementById("hangup-button") as HTMLButtonElement;
    if (hangupButtonElement)
        return hangupButtonElement;
    throw new Error("Cannot get hangup button");
}

function getLocalVideoMediaElement() {
    let localVideoElement = document.getElementById("local_video") as HTMLMediaElement;
    if (localVideoElement)
        return localVideoElement;
    throw new Error("Cannot get local video");
}

function getReceivedVideoMediaElement() {
    let receivedVideoElement = document.getElementById("received_video") as HTMLMediaElement;
    if (receivedVideoElement)
        return receivedVideoElement;
    throw new Error("Cannot get received video");
}


// Web-RTC actions ***********************************************************/


function closeVideoCall() {
    let remoteVideo = getReceivedVideoMediaElement();
    let localVideo = getLocalVideoMediaElement();

    if (myPeerConnection) {
        myPeerConnection.ontrack = null;
        myPeerConnection.onicecandidate = null;
        myPeerConnection.oniceconnectionstatechange = null;
        myPeerConnection.onsignalingstatechange = null;
        myPeerConnection.onicegatheringstatechange = null;
        myPeerConnection.onnegotiationneeded = null;

        if (remoteVideo.srcObject) {
            (<MediaStream>remoteVideo.srcObject).getTracks().forEach((track) => track.stop());
        }

        if (localVideo.srcObject) {
            (<MediaStream>localVideo.srcObject).getTracks().forEach((track) => track.stop());
        }

        myPeerConnection.close();
        myPeerConnection = null;
    }

    remoteVideo.removeAttribute("src");
    remoteVideo.removeAttribute("srcObject");
    localVideo.removeAttribute("src");
    remoteVideo.removeAttribute("srcObject");

    getHangupButtonElement().disabled = true;
    targetUserId = null;
};


function handleGetUserMediaError(e: Error) {
    switch (e.name) {
        case "NotFoundError":
            alert(
                "Unable to open your call because no camera and/or microphone" +
                "were found.",
            );
            break;
        case "SecurityError":
        case "PermissionDeniedError":
            // Do nothing; this is the same as the user canceling the call.
            break;
        default:
            alert("Error opening your camera and/or microphone: " + e.message);
            break;
    }

    closeVideoCall();
};

function handleICECandidateEvent(event: RTCPeerConnectionIceEvent) {
    if (targetUserId) {
        
        let content: NewIceCandidate = {
            userId: targetUserId,
            candidate: event.candidate,
        }
        let msg: Message = {
            signal: MessageSignal.NEW_ICE_CANDIDATE,
            content: content,
        }
        sendMessage(msg);

    } else {
        console.warn("Event candidate is null!");
    }
};


function handleTrackEvent(event: RTCTrackEvent) {
    event.streams[0].onremovetrack = (event: MediaStreamTrackEvent) => {
        let stream = (<MediaStream>getReceivedVideoMediaElement().srcObject);
        let trackList = stream.getTracks();
        if (trackList.length == 0) {
            closeVideoCall();
        }
    }
    getReceivedVideoMediaElement().srcObject = event.streams[0];
    getHangupButtonElement().disabled = false;

};


function handleNegotiationNeededEvent() {
    if (myPeerConnection) {

        myPeerConnection.createOffer()
            .then((offer) => {
                if (myPeerConnection)
                    return myPeerConnection.setLocalDescription(offer);
                throw new Error("Peer connection is't created!");
            })
            .then(() => {
                if (myPeerConnection && targetUserId) {
                    let content: VideoSDP = {
                        userId: targetUserId,
                        sdp: myPeerConnection.localDescription
                    }
                    let msg: Message = {
                        signal: MessageSignal.VIDEO_OFFER,
                        content: content
                    }
                    sendMessage(msg);
                } else {
                    throw new Error("Peer connection or target user Id is null!");
                }
            })
            .catch(reportError);

    } else {
        throw new Error("Peer connection or target user Id is null!");
    }
};

function handleICEConnectionStateChangeEvent(event: Event) {
    if (myPeerConnection) {
        switch (myPeerConnection.iceConnectionState) {
            case "closed":
            case "failed":
            case "disconnected":
                closeVideoCall();
                break;
        }
    } else {
        throw new Error("Peer connection is null!");
    }
};

function handleSignalingStateChangeEvent(event) {
    if (myPeerConnection) {
        switch (myPeerConnection.signalingState) {
            case "closed":
                closeVideoCall();
                break;
        }
    } else {
        throw new Error("Peer connection is null!");
    }
};

function createPeerConnection() {
    myPeerConnection = new RTCPeerConnection({
        iceServers: [
            // Information about ICE servers - Use your own!
            {
                urls: "stun:stun.stunprotocol.org",
            },
        ],
    });

    myPeerConnection.onicecandidate = handleICECandidateEvent;
    myPeerConnection.ontrack = handleTrackEvent;
    myPeerConnection.onnegotiationneeded = handleNegotiationNeededEvent;
    myPeerConnection.oniceconnectionstatechange = handleICEConnectionStateChangeEvent;
    myPeerConnection.onsignalingstatechange = handleSignalingStateChangeEvent;
};


/** business logic ***********************************************************/


function inviteUser(event) {
    if (myPeerConnection) {
        alert("You can't start a call because you already have one open!");
    } else {

        let clickedUserId: string = event.target.id;
        if (clickedUserId === USER_UUID) {
            alert("I'm afraid I can't let you talk to yourself.");
            return;
        }

        targetUserId = clickedUserId;
        createPeerConnection();
        navigator.mediaDevices
            .getUserMedia(mediaConstraints)
            .then((localStream) => {
                getLocalVideoMediaElement().srcObject = localStream;
                localStream
                    .getTracks()
                    .forEach((track) => {
                        if (myPeerConnection) {
                            myPeerConnection.addTrack(track, localStream)
                        } else {
                            throw new Error("Peer connections is't created!");
                        }
                    });
            })
            .catch(handleGetUserMediaError);
    }
};

function handleNewICECandidateMsg(newIceCandidate: NewIceCandidate) {
    var candidate = new RTCIceCandidate(newIceCandidate.candidate);
    if (myPeerConnection) {
        myPeerConnection.addIceCandidate(candidate).catch(reportError);
    } else {
        throw new Error("Peer connection is null!");
    }
}

function handleVideoOfferMsg(videOffer: VideoSDP) {
    let localStream: MediaStream | null = null;

    targetUserId = videOffer.userId;
    createPeerConnection();

    if (videOffer.sdp) {
        var desc = new RTCSessionDescription(videOffer.sdp);
    } else {
        throw new Error("SDP is null!");
    }

    if (myPeerConnection) {
        myPeerConnection
            .setRemoteDescription(desc)
            .then(function () {
                return navigator.mediaDevices.getUserMedia(mediaConstraints);
            })
            .then(function (stream) {
                localStream = stream;
                getLocalVideoMediaElement().srcObject = localStream;
                localStream
                    .getTracks()
                    .forEach((track) => {
                        if (myPeerConnection && localStream) {
                            myPeerConnection.addTrack(track, localStream)
                        } else {
                            throw new Error("Peer connection or/and local stream is null!");
                        }
                    });
            })
            .then(function () {
                if (myPeerConnection)
                    return myPeerConnection.createAnswer();
                throw new Error("Peer connection is null!");
            })
            .then(function (answer) {
                if (myPeerConnection)
                    return myPeerConnection.setLocalDescription(answer);
                throw new Error("Peer connection is null!");
            })
            .then(function () {
                if (targetUserId && myPeerConnection) {
                    let content: VideoSDP = {
                        userId: targetUserId,
                        sdp: myPeerConnection.localDescription
                    }
                    let msg: Message = {
                        signal: MessageSignal.VIDEO_ANSWER,
                        content: content
                    }
                    sendMessage(msg);
                } else {
                    throw new Error("Peer connection or target user id is null!");
                }
            })
            .catch(handleGetUserMediaError);
    } else {
        throw new Error("Peer connection wasn't created");
    }
};

function hangUpCall() {
    closeVideoCall();
    if (targetUserId) {
        let content: HangUp = {
            userId: targetUserId
        }
        let msg: Message = {
            signal: MessageSignal.HANG_UP,
            content: content,
        }
        sendMessage(msg);
    }
}

function sendMessage(msg: Message) {
    let msgJSON: string = JSON.stringify(msg);
    ws.send(msgJSON);
}

function clearUserList() {
    let userList = getUserListElement();
    const users = userList.querySelectorAll('li');
    users.forEach(li => {
        li.remove();
    });
}

function addNewUser(user: User) {
    let userList = getUserListElement();
    let userEl = document.createElement('li');
    let content = document.createTextNode(user.name)
    if (user.id === USER_UUID)
        content = document.createTextNode(CURRENT_USER_NAME)

    userEl.setAttribute("id", user.id)
    userEl.addEventListener("click", inviteUser, false);
    userEl.appendChild(content)
    userList.appendChild(userEl)
}

function removeUser(userId: string) {
    let userElement = getUserElement(userId);
    userElement.remove();
}