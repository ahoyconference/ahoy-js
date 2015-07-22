function AhoyConference(delegate, options) {
  this.delegate = delegate;
  this.ws = null;
  this.wsUrl = null;
  this.createConferenceOptions = null;
  this.conferenceName = null;
  this.description = null;
  this.isSpeaker = false;
  this.isModerator = false;
  this.localStream = null;
  this.pc = null;
  this.memberID = null;
  this.members = {};
  this.transactionCallbacks = {};
  this.receiveAudio = true;
  this.receiveVideo = true;
  if (options != undefined) {
    if (options.receiveAudio != undefined) {
      this.receiveAudio = options.receiveAudio;
    }
    if (options.receiveVideo != undefined) {
      this.receiveVideo = options.receiveVideo;
    }
  }
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
    self.delegate.error(self, error, true);
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

AhoyConference.prototype.handleConferenceCreateResponse = function(msg) {
  var self = this;

  var callback = self.transactionCallbacks[msg.transactionID];
  if (!callback) {
    console.log('CONFERENCE_CREATE_request for unknown transactionID: ' + msg.transactionID);
    return;
  }
  delete self.transactionCallbacks[msg.transactionID];

  switch (msg.status) {
    case 200:
      self.conferenceID = msg.conferenceID;
    case 486:
      callback(null, self);
      break;

    default:
    console.log(msg);
    callback({ errorCode: msg.status, errorText: msg.reason});
  }
}

AhoyConference.prototype.handleConferenceJoinResponse = function(msg) {
  var self = this;

  switch (msg.status) {
    case 200:
      self.conferenceName = msg.conferenceName;
      self.description = msg.description;
      self.isSpeaker = msg.speaker;
      self.isModerator = msg.moderator;
      self.memberID = msg.memberID;
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
          ahoyConferenceMember.requestMedia(self.receiveAudio, self.receiveVideo, function(error, stream) {
            if (error) {
              self.delegate.error(self, error, false);
            } else {
              self.delegate.memberDidStartSharingMedia(self, ahoyConferenceMember, stream);
            }
          });
        }
      });
      break;

    case 302:
      self.connect(msg.url);
      break;

    default:
      console.log(msg);
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
    member.requestMedia(self.receiveAudio, self.receiveVideo, function(error, stream) {
      if (error) {
        self.delegate.error(self, error, false);
      } else {
        self.delegate.memberDidStartSharingMedia(self, member, stream);
      }
    });

  } else {
    if (wasSharingMedia) {
      self.delegate.memberDidStopSharingMedia(self, member);
    }
  }
}

AhoyConference.prototype.handleMediaEvent = function(msg) {
  var self = this;
  // ignore events for ourself
  if (self.memberID == msg.member.memberID) return;

  var member = self.members[msg.member.memberID];

  if (!member) {
    console.log('MEDIA_event for unknown member: ' + msg.member.memberID);
    return;
  }
  if (self.delegate.mediaEvent != undefined) {
    self.delegate.mediaEvent(self, member, msg.event);
  }
}

AhoyConference.prototype.handleMediaResponse = function(msg) {
  var self = this;
  var member = self.members[msg.transactionID];

  if (!member) {
    console.log('MEDIA_response for unknown member: ' + msg.transactionID);
    return;
  }
}

AhoyConference.prototype.handleSdpRequest = function(msg) {
  var self = this;
  var member = self.members[msg.member.memberID];

  if (!member) {
    console.log('SDP_request for unknown member: ' + msg.member.memberID);
    return;
  }
  var callback = self.transactionCallbacks[msg.member.memberID];
  if (!callback) {
    console.log('SDP_request for unknown transactionID: ' + msg.member.memberID);
  } else {
    delete self.transactionCallbacks[msg.member.memberID];
    member.createSdpResponse(msg, callback);
  }
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
              self.delegate.error(self, error, true);
            }
          )
        },
        function createAnswerError(error) {
          self.delegate.error(self, error, true);
        }
      );
    },
    function error(error) {
      self.delegate.error(self, error, true);
    }
  );

}

AhoyConference.prototype.setLocked = function(locked, callback) {
  var self = this;
  var transactionID = 'lock-' + Math.random();
  self.sendMessage(
    {
      messageType: "CONFERENCE_LOCK_request",
      lock: locked,
      transactionID: transactionID
    }
  );
  if (callback != undefined) {
    self.transactionCallbacks[transactionID] = callback;
  }
}

AhoyConference.prototype.lock = function(callback) {
  var self = this;
  self.setLocked(true, callback);
}

AhoyConference.prototype.unlock = function(callback) {
  var self = this;
  self.setLocked(false, callback);
}

AhoyConference.prototype.handleConferenceLockResponse = function(msg) {
  var self = this;

  var callback = self.transactionCallbacks[msg.transactionID];
  if (callback) {
    delete self.transactionCallbacks[msg.transactionID];
    callback();
  }
}

AhoyConference.prototype.handleConferenceLockIndication = function(msg) {
  var self = this;

  if (msg.locked) {
    if (self.delegate.conferenceDidGetLocked != undefined) {
      self.delegate.conferenceDidGetLocked(self);
    }
  } else {
    if (self.delegate.conferenceDidGetUnlocked != undefined) {
      self.delegate.conferenceDidGetUnlocked(self);
    }
  }
}

AhoyConference.prototype.handleConferenceKickResponse = function(msg) {
  var self = this;

  var callback = self.transactionCallbacks[msg.transactionID];
  if (callback) {
    delete self.transactionCallbacks[msg.transactionID];
    if (msg.status == 200) {
      callback();
    } else {
      callback({ errorCode: msg.status, errorText: msg.reason });
    }
  }
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

AhoyConference.prototype.handleChatMessageIndication = function(msg) {
  var self = this;
  var member = self.members[msg.from.memberID];

  if (!member) {
    console.log('CHAT_MESSAGE_indication for unknown member: ' + msg.from.memberID);
    return;
  }
  if (self.delegate.memberDidSendChatMessage != undefined) {
    self.delegate.memberDidSendChatMessage(self, member, msg.message);
  }
}

AhoyConference.prototype.sendChatMessage = function(text, callback) {
  var self = this;
  var transactionID = 'chat-' + Math.random();
  if (text instanceof String === false) {
    text = JSON.stringify(text);
  }
  self.sendMessage(
    {
      messageType: "CHAT_MESSAGE_request",
      message: {
        text: text
      },
      transactionID: transactionID
    }
  );
  if (callback != undefined) {
    self.transactionCallbacks[transactionID] = callback;
  }
}

AhoyConference.prototype.handleChatMessageResponse = function(msg) {
  var self = this;

  var callback = self.transactionCallbacks[msg.transactionID];
  if (callback) {
    delete self.transactionCallbacks[msg.transactionID];
    callback();
  }
}

AhoyConference.prototype.publishMedia = function(audio, video, videoBitrate) {
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
  self.handleConferenceEnded(false);
}

AhoyConference.prototype.connect = function(wsUrl, callback) {
  var self = this;

  if (self.ws) {
    self.ws.onclose = null;
    self.ws.onerror = null;
    self.ws.close();
  }
  self.ws = new WebSocket(wsUrl, 'conference-protocol');

  self.ws.onmessage = function(message) {
    try {
      var msg = JSON.parse(message.data);
    } catch (error) {
      self.delegate.error(self, error, false);
    }
    switch (msg.messageType) {
      case 'CONFERENCE_CREATE_response':
        self.handleConferenceCreateResponse(msg);
        break;

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

      case 'CONFERENCE_KICK_response':
        self.handleConferenceKickResponse(msg);
        break;

      case 'CONFERENCE_KICK_indication':
        self.handleConferenceEnded(true);
        break;

      case 'CONFERENCE_LOCK_indication':
        self.handleConferenceLockIndication(msg);
        break;

      case 'CONFERENCE_LOCK_response':
        self.handleConferenceLockResponse(msg);
        break;

      case 'MEDIA_indication':
        self.handleMediaIndication(msg);
        break;

      case 'MEDIA_event':
        self.handleMediaEvent(msg);
        break;

      case 'CHAT_MESSAGE_indication':
        self.handleChatMessageIndication(msg);
        break;

      case 'CHAT_MESSAGE_response':
        self.handleChatMessageResponse(msg);
        break;
    }
  }

  self.ws.onopen = function() {
    if (self.invitation != undefined) {
      var msg = {
        messageType: "CONFERENCE_JOIN_request",
        invitation: self.invitation,
        name: self.name
      };
    } else if (self.createConferenceOptions) {
      var msg = self.createConferenceOptions;
      msg.transactionID = 'id-' + Math.random();
      msg.messageType = 'CONFERENCE_CREATE_request';
      self.createConferenceOptions = null;
      self.transactionCallbacks[msg.transactionID] = callback;
    } else {
      var msg = {
        messageType: "CONFERENCE_JOIN_request",
        conferenceID: self.conferenceID,
        name: self.name,
        password: self.password
      };
    }
    self.sendMessage(msg);
  }

  self.ws.onclose = function() {
    self.handleConferenceEnded(false);
  }
}

AhoyConference.prototype.joinWithInvitation = function(token) {
  var self = this;
  try {
      var data = atob(token);
      if (data != null) {
          link = JSON.parse(data);
          console.log(link);
          self.invitation = link.invitation;
          self.connect(link.wsUrl);
      }
  } catch (error) {
    self.delegate.error(self, error, true);
  }
}

AhoyConference.prototype.join = function(name, wsUrl, conferenceID, password) {
  var self = this;
  if (conferenceID != undefined) {
    self.conferenceID = conferenceID;
  }
  if (name != undefined) {
    self.name = name;
  }
  if (password != undefined) {
    self.password = password;
  }
  if (wsUrl != undefined) {
    self.wsUrl = wsUrl;
  }
  self.connect(self.wsUrl);
}

AhoyConference.prototype.create = function(wsUrl, conferenceName, listenerPassword, speakerPassword, moderatorPassword, callback) {
  var self = this;
  if (moderatorPassword == undefined) {
    moderatorPassword = 'pw' +  Math.random() + Date.now();
  }
  self.createConferenceOptions = {
    conferenceID: conferenceName,
    conferenceName: conferenceName,
    listenerPassword: listenerPassword,
    password: speakerPassword,
    moderatorPassword: moderatorPassword
  }
  self.conferenceID = conferenceName;
  self.password = moderatorPassword;
  self.wsUrl = wsUrl;
  self.connect(wsUrl, callback);
}
