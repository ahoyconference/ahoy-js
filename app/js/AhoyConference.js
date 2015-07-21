function AhoyConferenceMember(conference, member) {
  try {
    this.conference = conference;
    this.memberID = member.memberID;
    this.name = member.name;
    this.isModerator = member.moderator;
    this.isSpeaker = member.isSpeaker;
    this.isAudioAvailable = member.audio.available;
    this.isVideoAvailable = member.video.available;
    this.pc = null;
  } catch (error) {
    console.log(error);
  }
}

AhoyConferenceMember.prototype.requestMedia = function(audio, video, callback) {
  var self = this;
  var conference = self.conference;
  if (self.isAudioAvailable || self.isVideoAvailable) {
    console.log('requesting media for member: ' + self.name);
    conference.mediaCallbacks[self.memberID] = callback;
    conference.sendMessage(
      {
        messageType: "MEDIA_request",
        members: [
            {
              memberID: self.memberID,
              audio: (audio & self.isAudioAvailable),
              video: (video & self.isVideoAvailable),
            }
        ],
        transactionID: self.memberID
      }
    );
  } else {
    callback({ errorCode: 404, errorText: "no media available"});
  }
}


AhoyConferenceMember.prototype.createSdpResponse = function(sessionOffer, callback) {
  var self = this;
  var conference = self.conference;
  self.pc = conference.createPeerConnection();

  if (!self.pc) {
    console.log('unable to create peerconnection');
    callback({ errorCode: 500, errorText: 'unable to create peerconnection'});
    return;
  }

  var remoteDescription = new RTCSessionDescription( { type: "offer", sdp: unescape(sessionOffer.sdp) } );
  self.pc.onaddstream = function(event) {
    callback(null, event.stream);
  };
  self.pc.setRemoteDescription(
    remoteDescription,
    function setRemoteSuccess() {
      self.pc.createAnswer(
        function createAnswerSuccess(description) {
          conference.sendMessage(
            {
              messageType: "SDP_response",
              sdp: escape(description.sdp),
              transactionID: sessionOffer.transactionID
            }
          );
          self.pc.setLocalDescription(
            description,
            function setLocalSuccess() {
            },
            function setLocalError(error) {
              console.log(error);
              callback(error);
            }
          )
        },
        function createAnswerError(error) {
          console.log(error);
          callback(error);
        }
      );
    },
    function error(error) {
      console.log(error);
      callback(error);
    }
  );
}

function AhoyConference(wsUrl, conferenceID, name, password, delegate) {
  this.wsUrl = wsUrl;
  this.connectWsUrl = wsUrl;
  this.conferenceID = conferenceID;
  this.name = name;
  this.password = password;
  this.ws = null;
  this.delegate = delegate;
  this.conferenceName = null;
  this.description = null;
  this.members = {};
  this.mediaCallbacks = {};
  this.localStream = null;
  this.pc = null;
  this.isSpeaker = false;
  this.isModerator = false;
}

AhoyConference.prototype.createPeerConnection = function(turn) {
  var self = this;
  var pc = null;
  try {
    var pc_config = null;
    if (turn) {
      var iceServers = [];
      turn.urls.forEach(function(url) {
        iceServers.push( { url: url, urls: url, username: turn.username, credential: turn.credential} );
      });
      if (iceServers.length > 0) {
        pc_config = {
          iceServers: iceServers
        };
      }
    }
    pc = new RTCPeerConnection(pc_config);
  } catch (error) {
    console.log(error);
  }
  return pc
}

AhoyConference.prototype.sendMessage = function(msg) {
  var self = this;
  if (msg.transactionID == undefined) {
    msg.transactionID = 'id' + Math.random();
  }
  if (self.ws) {
    self.ws.send(JSON.stringify(msg));
  }
}

AhoyConference.prototype.handleConferenceJoinResponse = function(msg) {
  var self = this;
  console.log(msg);
  switch (msg.status) {
    case 200:
      self.conferenceName = msg.conferenceName;
      self.description = msg.description;
      self.isSpeaker = msg.speaker;
      self.isModerator = msg.moderator;
      msg.members.forEach(function(member) {
        var ahoyConferenceMember = new AhoyConferenceMember(self, member);
        self.members[ahoyConferenceMember.memberID] = ahoyConferenceMember;
      });
      self.delegate.didJoinConference(null, self);
      var memberIDs = Object.keys(self.members);
      memberIDs.forEach(function(memberID) {
        var ahoyConferenceMember = self.members[memberID];
        self.delegate.memberDidJoinConference(self, ahoyConferenceMember);
        if (ahoyConferenceMember.isAudioAvailable || ahoyConferenceMember.isVideoAvailable) {
          self.delegate.memberDidStartSharingMedia(self, ahoyConferenceMember);
        }
      });
      break;

    default:
      console.log(msg.status);
      self.delegate.didJoinConference({ errorCode: status, errorText: msg.reason});
  }
}

AhoyConference.prototype.handleConferenceJoinIndication = function(msg) {
  var self = this;
  var ahoyConferenceMember = new AhoyConferenceMember(self, msg.member);
  self.members[ahoyConferenceMember.memberID] = ahoyConferenceMember;
  self.delegate.memberDidJoinConference(self, ahoyConferenceMember);
}

AhoyConference.prototype.handleConferenceLeaveIndication = function(msg) {
  var self = this;
  var member = self.members[msg.member.memberID];
  if (!member) {
    console.log('CONFERENCE_LEAVE_indication for unknown member: ' + msg.member.memberID);
  }
  delete self.members[member.memberID];

  if (member.pc) {
    self.delegate.memberDidStopSharingMedia(self, member);
    member.pc.close();
    member.pc = null;
  }
  self.delegate.memberDidLeaveConference(self, member);
}

AhoyConference.prototype.handleMediaIndication = function(msg) {
  var self = this;
  var member = self.members[msg.member.memberID];

  if (!member) {
    console.log('MEDIA_indication for unknown member: ' + msg.member.memberID);
    return;
  }
  var wasSharingMedia = member.isAudioAvailable | member.isVideoAvailable;
  var isSharingMedia = msg.audio.available | msg.video.available;
  member.isAudioAvailable = msg.audio.available;
  member.isVideoAvailable = msg.video.available;
  if (isSharingMedia) {
    if (wasSharingMedia) {
      self.delegate.memberDidStopSharingMedia(self, member);
    }
    self.delegate.memberDidStartSharingMedia(self, member);
  } else {
    if (wasSharingMedia) {
      self.delegate.memberDidStopSharingMedia(self, member);
    }
  }
}


AhoyConference.prototype.handleMediaResponse = function(msg) {
  var self = this;
  var member = self.members[msg.transactionID];

  if (!member) {
    console.log('MEDIA_response for unknown member: ' + msg.transactionID);
    return;
  }
  var callback = self.mediaCallbacks[msg.transactionID];
  if (!callback) {
    console.log('MEDIA_response for unknown transactionID: ' + msg.transactionID);
  }
}

AhoyConference.prototype.handleSdpRequest = function(msg) {
  var self = this;
  var member = self.members[msg.member.memberID];

  if (!member) {
    console.log('SDP_request for unknown member: ' + msg.member.memberID);
    return;
  }
  var callback = self.mediaCallbacks[msg.member.memberID];
  if (!callback) {
    console.log('SDP_request for unknown transactionID: ' + msg.member.memberID);
  }
  member.createSdpResponse(msg, callback);
}

AhoyConference.prototype.handleMediaReceiveRequest = function(msg) {
  var self = this;
  self.pc = self.createPeerConnection();
  self.pc.addStream(self.localStream);

  if (!self.pc) {
    console.log('unable to create peerconnection');
    return;
  }

  var remoteDescription = new RTCSessionDescription( { type: "offer", sdp: unescape(msg.sdp) } );

  self.pc.setRemoteDescription(
    remoteDescription,
    function setRemoteSuccess() {
      self.pc.createAnswer(
        function createAnswerSuccess(description) {
          conference.sendMessage(
            {
              messageType: "MEDIA_RECEIVE_response",
              sdp: escape(description.sdp),
              transactionID: msg.transactionID
            }
          );
          self.pc.setLocalDescription(
            description,
            function setLocalSuccess() {
            },
            function setLocalError(error) {
              console.log(error);
            }
          )
        },
        function createAnswerError(error) {
          console.log(error);
        }
      );
    },
    function error(error) {
      console.log(error);
    }
  );

}
AhoyConference.prototype.handleConferenceEnded = function(kicked) {
  var self = this;
  var memberIDs = Object.keys(self.members);
  memberIDs.forEach(function(memberID) {
    var member = self.members[memberID];
    self.delegate.memberDidStopSharingMedia(self, member);
    self.delegate.memberDidLeaveConference(self, member);
    if (member.pc) {
      member.pc.close();
      member.pc = null;
    }
    delete self.members[memberID];
  });
  if (self.pc) {
    self.pc.close();
    self.pc = null;
  }
  self.delegate.didLeaveConference(self, kicked);
}

AhoyConference.prototype.publishMedia = function(audio, video, videoBitrate, callback) {
  var self = this;
  self.sendMessage(
    {
      messageType: "MEDIA_SHARE_request",
      audio: audio,
      video: video,
      maxVideoBitrate: videoBitrate
    }
  );
}

AhoyConference.prototype.leave = function() {
  var self = this;

  if (self.ws) {
    self.ws.onclose = null;
    self.ws.onerror = null;
    self.ws.close();
    self.ws = nulll;
  }
}

AhoyConference.prototype.join = function() {
  var self = this;
  self.ws = new WebSocket(self.connectWsUrl, 'conference-protocol');

  self.ws.onmessage = function(message) {
    try {
      var msg = JSON.parse(message.data);
    } catch (error) {
        console.log(error);
    }
    switch (msg.messageType) {

      case 'CONFERENCE_JOIN_response':
        self.handleConferenceJoinResponse(msg);
        break;

      case 'MEDIA_response':
        self.handleMediaResponse(msg);
        break;

      case 'MEDIA_SHARE_response':
        break;

      case 'MEDIA_RECEIVE_request':
        self.handleMediaReceiveRequest(msg);
        break;

      case 'SDP_request':
        self.handleSdpRequest(msg);
      break;

      case 'CONFERENCE_JOIN_indication':
        self.handleConferenceJoinIndication(msg);
        break;

      case 'CONFERENCE_LEAVE_indication':
        self.handleConferenceLeaveIndication(msg);
        break;

      case 'CONFERENCE_KICK_indication':
        self.handleConferenceEnded(true);
        break;

      case 'MEDIA_indication':
        self.handleMediaIndication(msg);
        break;

    }
  }

  self.ws.onopen = function() {
    self.sendMessage(
      {
        messageType: "CONFERENCE_JOIN_request",
        conferenceID: self.conferenceID,
        name: self.name,
        password: self.password
      }
    );
  }

  self.ws.onclose = function() {
    self.handleConferenceEnded(false);
  }

}
