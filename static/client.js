// utils *********************************************************************/
function generateUUIDv4() {
    return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, function (c) { return (parseInt(c) ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> parseInt(c) / 4).toString(16); });
}
// interfaces & constance's **************************************************/
var MessageSignal;
(function (MessageSignal) {
    MessageSignal["USER_CONNECTED"] = "USER_CONNECTED";
    MessageSignal["USER_DISCONNECTED"] = "USER_DISCONNECTED";
    MessageSignal["NEW_ICE_CANDIDATE"] = "NEW_ICE_CANDIDATE";
    MessageSignal["VIDEO_OFFER"] = "VIDEO_OFFER";
    MessageSignal["VIDEO_ANSWER"] = "VIDEO_ANSWER";
    MessageSignal["HANG_UP"] = "HANG_UP";
})(MessageSignal || (MessageSignal = {}));
var mediaConstraints = {
    audio: true, // We want an audio track
    video: true // ...and we want a video track
};
var CURRENT_USER_NAME = "It's you";
var USER_UUID = generateUUIDv4();
var ws = new WebSocket("ws://localhost:8000/ws/".concat(USER_UUID));
var myPeerConnection = null;
var targetUserId = null;
// ws actions ****************************************************************/
ws.onmessage = function (event) {
    var message = JSON.parse(event.data);
    switch (message.signal) {
        case MessageSignal.USER_CONNECTED:
            clearUserList();
            for (var _i = 0, _a = message.content; _i < _a.length; _i++) {
                var user = _a[_i];
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
            console.error("IDK how to read this data ".concat(message));
            break;
    }
};
// DOM actions ***************************************************************/
function getUserListElement() {
    var userList = document.getElementById('users');
    if (userList)
        return userList;
    throw new Error("Cannot get users list");
}
function getUserElement(userId) {
    var userElement = document.getElementById(userId);
    if (userElement)
        return userElement;
    throw new Error("Cannot get user");
}
function getHangupButtonElement() {
    var hangupButtonElement = document.getElementById("hangup-button");
    if (hangupButtonElement)
        return hangupButtonElement;
    throw new Error("Cannot get hangup button");
}
function getLocalVideoMediaElement() {
    var localVideoElement = document.getElementById("local_video");
    if (localVideoElement)
        return localVideoElement;
    throw new Error("Cannot get local video");
}
function getReceivedVideoMediaElement() {
    var receivedVideoElement = document.getElementById("received_video");
    if (receivedVideoElement)
        return receivedVideoElement;
    throw new Error("Cannot get received video");
}
// Web-RTC actions ***********************************************************/
function closeVideoCall() {
    var remoteVideo = getReceivedVideoMediaElement();
    var localVideo = getLocalVideoMediaElement();
    if (myPeerConnection) {
        myPeerConnection.ontrack = null;
        myPeerConnection.onicecandidate = null;
        myPeerConnection.oniceconnectionstatechange = null;
        myPeerConnection.onsignalingstatechange = null;
        myPeerConnection.onicegatheringstatechange = null;
        myPeerConnection.onnegotiationneeded = null;
        if (remoteVideo.srcObject) {
            remoteVideo.srcObject.getTracks().forEach(function (track) { return track.stop(); });
        }
        if (localVideo.srcObject) {
            localVideo.srcObject.getTracks().forEach(function (track) { return track.stop(); });
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
}
;
function handleGetUserMediaError(e) {
    switch (e.name) {
        case "NotFoundError":
            alert("Unable to open your call because no camera and/or microphone" +
                "were found.");
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
}
;
function handleICECandidateEvent(event) {
    if (targetUserId) {
        var content = {
            userId: targetUserId,
            candidate: event.candidate,
        };
        var msg = {
            signal: MessageSignal.NEW_ICE_CANDIDATE,
            content: content,
        };
        sendMessage(msg);
    }
    else {
        console.warn("Event candidate is null!");
    }
}
;
function handleTrackEvent(event) {
    event.streams[0].onremovetrack = function (event) {
        var stream = getReceivedVideoMediaElement().srcObject;
        var trackList = stream.getTracks();
        if (trackList.length == 0) {
            closeVideoCall();
        }
    };
    getReceivedVideoMediaElement().srcObject = event.streams[0];
    getHangupButtonElement().disabled = false;
}
;
function handleNegotiationNeededEvent() {
    if (myPeerConnection) {
        myPeerConnection.createOffer()
            .then(function (offer) {
            if (myPeerConnection)
                return myPeerConnection.setLocalDescription(offer);
            throw new Error("Peer connection is't created!");
        })
            .then(function () {
            if (myPeerConnection && targetUserId) {
                var content = {
                    userId: targetUserId,
                    sdp: myPeerConnection.localDescription
                };
                var msg = {
                    signal: MessageSignal.VIDEO_OFFER,
                    content: content
                };
                sendMessage(msg);
            }
            else {
                throw new Error("Peer connection or target user Id is null!");
            }
        })
            .catch(reportError);
    }
    else {
        throw new Error("Peer connection or target user Id is null!");
    }
}
;
function handleICEConnectionStateChangeEvent(event) {
    if (myPeerConnection) {
        switch (myPeerConnection.iceConnectionState) {
            case "closed":
            case "failed":
            case "disconnected":
                closeVideoCall();
                break;
        }
    }
    else {
        throw new Error("Peer connection is null!");
    }
}
;
function handleSignalingStateChangeEvent(event) {
    if (myPeerConnection) {
        switch (myPeerConnection.signalingState) {
            case "closed":
                closeVideoCall();
                break;
        }
    }
    else {
        throw new Error("Peer connection is null!");
    }
}
;
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
}
;
/** business logic ***********************************************************/
function inviteUser(event) {
    if (myPeerConnection) {
        alert("You can't start a call because you already have one open!");
    }
    else {
        var clickedUserId = event.target.id;
        if (clickedUserId === USER_UUID) {
            alert("I'm afraid I can't let you talk to yourself.");
            return;
        }
        targetUserId = clickedUserId;
        createPeerConnection();
        navigator.mediaDevices
            .getUserMedia(mediaConstraints)
            .then(function (localStream) {
            getLocalVideoMediaElement().srcObject = localStream;
            localStream
                .getTracks()
                .forEach(function (track) {
                if (myPeerConnection) {
                    myPeerConnection.addTrack(track, localStream);
                }
                else {
                    throw new Error("Peer connections is't created!");
                }
            });
        })
            .catch(handleGetUserMediaError);
    }
}
;
function handleNewICECandidateMsg(newIceCandidate) {
    var candidate = new RTCIceCandidate(newIceCandidate.candidate);
    if (myPeerConnection) {
        myPeerConnection.addIceCandidate(candidate).catch(reportError);
    }
    else {
        throw new Error("Peer connection is null!");
    }
}
function handleVideoOfferMsg(videOffer) {
    var localStream = null;
    targetUserId = videOffer.userId;
    createPeerConnection();
    if (videOffer.sdp) {
        var desc = new RTCSessionDescription(videOffer.sdp);
    }
    else {
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
                .forEach(function (track) {
                if (myPeerConnection && localStream) {
                    myPeerConnection.addTrack(track, localStream);
                }
                else {
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
                var content = {
                    userId: targetUserId,
                    sdp: myPeerConnection.localDescription
                };
                var msg = {
                    signal: MessageSignal.VIDEO_ANSWER,
                    content: content
                };
                sendMessage(msg);
            }
            else {
                throw new Error("Peer connection or target user id is null!");
            }
        })
            .catch(handleGetUserMediaError);
    }
    else {
        throw new Error("Peer connection wasn't created");
    }
}
;
function hangUpCall() {
    closeVideoCall();
    if (targetUserId) {
        var content = {
            userId: targetUserId
        };
        var msg = {
            signal: MessageSignal.HANG_UP,
            content: content,
        };
        sendMessage(msg);
    }
}
function sendMessage(msg) {
    var msgJSON = JSON.stringify(msg);
    ws.send(msgJSON);
}
function clearUserList() {
    var userList = getUserListElement();
    var users = userList.querySelectorAll('li');
    users.forEach(function (li) {
        li.remove();
    });
}
function addNewUser(user) {
    var userList = getUserListElement();
    var userEl = document.createElement('li');
    var content = document.createTextNode(user.name);
    if (user.id === USER_UUID)
        content = document.createTextNode(CURRENT_USER_NAME);
    userEl.setAttribute("id", user.id);
    userEl.addEventListener("click", inviteUser, false);
    userEl.appendChild(content);
    userList.appendChild(userEl);
}
function removeUser(userId) {
    var userElement = getUserElement(userId);
    userElement.remove();
}
