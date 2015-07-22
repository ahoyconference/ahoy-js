function AhoyConferenceMember(conference, member) {
  try {
    this.conference = conference;
    this.memberID = member.memberID;
    this.name = member.name;
    this.isModerator = member.moderator;
    this.isSpeaker = member.isSpeaker;
    this.isAudioAvailable = member.audio.available;
    this.isVideoAvailable = member.video.available;
    this.isSpeaking = member.audio.speaking;
    this.stream = null;
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
    conference.transactionCallbacks[self.memberID] = callback;
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

AhoyConferenceMember.prototype.kick = function(callback) {
  var self = this;
  var conference = self.conference;
  var transactionID = 'kick-' + Math.random();
  console.log('kicking member: ' + self.name);
  conference.transactionCallbacks[transactionID] = callback;
  conference.sendMessage(
    {
      messageType: "CONFERENCE_KICK_request",
      memberID: self.memberID,
      transactionID: transactionID
    }
  );
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
    self.stream = event.stream;
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
              callback(error);
            }
          )
        },
        function createAnswerError(error) {
          callback(error);
        }
      );
    },
    function error(error) {
      callback(error);
    }
  );
}
