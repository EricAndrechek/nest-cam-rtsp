import { TLSSocket, connect } from 'tls';
import { Socket } from 'net';
import { FfmpegProcess } from './ffmpeg';
import Pbf from 'pbf';
import { PlaybackPacket, PacketType } from './protos/PlaybackPacket';
import { Redirect } from './protos/Redirect';
import { Hello } from './protos/Hello';
import { AuthorizeRequest } from './protos/AuthorizeRequest';
import { AudioPayload } from './protos/AudioPayload';
import { StartPlayback } from './protos/StartPlayback';
import { StopPlayback } from './protos/StopPlayback';
import { StreamProfile, PlaybackBegin, CodecType } from './protos/PlaybackBegin';
import { PlaybackEnd } from './protos/PlaybackEnd';
import { Error, ErrorCode } from './protos/Error';

export class NexusStreamer {
  private ffmpegVideo: FfmpegProcess;
  private ffmpegAudio: FfmpegProcess | undefined;
  private ffmpegReturnAudio: FfmpegProcess | undefined;
  private authorized = false;
  private sessionID: number = Math.floor(Math.random() * 100); // alright then
  private host = '';
  private accessToken = '';
  private socket: TLSSocket = new TLSSocket(new Socket());
  private pendingMessages: Array<{ type: number; buffer: Uint8Array }> = [];
  private pendingBuffer: Buffer | undefined;
  private videoChannelID = -1;
  private audioChannelID = -1;
  private returnAudioTimeout: NodeJS.Timeout | undefined;
  private started = false;
  private uuid = '';

  constructor(
    accessToken: string,
    stream_url: string,
    uuid: string,
    ffmpegVideo: FfmpegProcess,
    ffmpegAudio?: FfmpegProcess,
    ffmpegReturnAudio?: FfmpegProcess,
  ) {
    this.ffmpegVideo = ffmpegVideo;
    this.ffmpegAudio = ffmpegAudio;
    this.ffmpegReturnAudio = ffmpegReturnAudio;
    this.accessToken = accessToken; // jwt
    this.host = stream_url; // stream_url
    this.uuid = uuid; // stream_url
    this.setupConnection();
  }

  /**
   * Close the socket and stop playback
   */
  stopPlayback(): void {
    this.started = false;
    if (this.socket) {
      this.sendStopPlayback();
      this.socket.end();
    }
  }

  /**
   * Create the return audio server
   */
  private createReturnAudioServer(): void {
    const self = this;
    const stdout = this.ffmpegReturnAudio?.getStdout();
    if (stdout) {
      stdout.on('data', (chunk) => {
        this.sendAudioPayload(Buffer.from(chunk));

        if (this.returnAudioTimeout) {
          clearTimeout(this.returnAudioTimeout);
        }
        this.returnAudioTimeout = setTimeout(() => {
          self.sendAudioPayload(Buffer.from([]));
        }, 1000);
      });
    }
  }

  /**
   * Setup socket communication and send hello packet
   */
  private setupConnection(): void {
    const self = this;
    let pingInterval: NodeJS.Timeout;

    this.stopPlayback();
    this.createReturnAudioServer();
    const options = {
      host: this.host,
      port: 1443,
    };
    this.socket = connect(options, () => {
       console.log('[NexusStreamer] Connected');
      self.requestHello();
      pingInterval = setInterval(() => {
        self.sendPingMessage();
      }, 15000);
    });

    this.socket.on('data', (data) => {
      self.handleNexusData(data);
    });

    this.socket.on('end', () => {
      self.unschedulePingMessage(pingInterval);
       console.log('[NexusStreamer] Disconnected');
    });
  }

  private processPendingMessages(): void {
    if (this.pendingMessages) {
      const messages = this.pendingMessages;
      this.pendingMessages = [];
      messages.forEach((message) => {
        this.sendMessage(message.type, message.buffer);
      });
    }
  }

  /**
   * Send data to socket
   * @param {number} type The type of packet being sent
   * @param {Uint8Array} buffer  The information to send
   */
  private sendMessage(type: number, buffer: Uint8Array): void {
    if (this.socket.connecting || !this.socket.encrypted) {
       console.log('waiting for socket to connect');
      if (!this.pendingMessages) {
        this.pendingMessages = [];
      }
      this.pendingMessages.push({
        type,
        buffer,
      });
      return;
    }

    if (type !== PacketType.HELLO && !this.authorized) {
       console.log('waiting for authorization');
      if (!this.pendingMessages) {
        this.pendingMessages = [];
      }
      this.pendingMessages.push({
        type,
        buffer,
      });
      return;
    }

    let requestBuffer;
    if (type === 0xcd) {
      // Long packet
      requestBuffer = Buffer.alloc(5);
      requestBuffer[0] = type;
      requestBuffer.writeUInt32BE(buffer.length, 1);
      requestBuffer = Buffer.concat([requestBuffer, Buffer.from(buffer)]);
    } else {
      requestBuffer = Buffer.alloc(3);
      requestBuffer[0] = type;
      requestBuffer.writeUInt16BE(buffer.length, 1);
      requestBuffer = Buffer.concat([requestBuffer, Buffer.from(buffer)]);
    }
    if (!this.socket.destroyed) {
      this.socket.write(requestBuffer);
    }
  }

  // Ping

  private sendPingMessage(): void {
    this.sendMessage(1, Buffer.alloc(0));
  }

  private unschedulePingMessage(pingInterval: NodeJS.Timeout): void {
    clearInterval(pingInterval);
  }

  /**
   * Authenticate the socket session
   */
  private requestHello(): void {
    const token = {
      olive_token: this.accessToken,
    };
    const tokenContainer = new Pbf();
    AuthorizeRequest.write(token, tokenContainer);
    const tokenBuffer = tokenContainer.finish();

    const request = {
      protocol_version: Hello.ProtocolVersion.VERSION_3,
      uuid: this.uuid,
      device_id: this.uuid,
      require_connected_camera: false,
      user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/77.0.3865.120 Safari/537.36',
      client_type: Hello.ClientType.WEB,
      authorize_request: tokenBuffer,
    };
    const pbfContainer = new Pbf();
    Hello.write(request, pbfContainer);
    const buffer = pbfContainer.finish();
    this.sendMessage(PacketType.HELLO, buffer);
  }

  private updateAuthentication(): void {
    const token = {
      olive_token: this.accessToken,
    };
    const tokenContainer = new Pbf();
    AuthorizeRequest.write(token, tokenContainer);
    const tokenBuffer = tokenContainer.finish();
    this.sendMessage(PacketType.AUTHORIZE_REQUEST, tokenBuffer);
  }

  startPlayback(): void {
    this.started = true;
    // Attempt to use camera's stream profile or use default
    // const cameraProfile = this.cameraInfo.properties['streaming.cameraprofile'] as keyof typeof StreamProfile;
    // const primaryProfile = StreamProfile[cameraProfile] || StreamProfile.VIDEO_H264_2MBIT_L40;
    // const otherProfiles = [];
    // this.cameraInfo.capabilities.forEach((element) => {
    //   if (element.startsWith('streaming.cameraprofile')) {
    //     const profile = element.replace('streaming.cameraprofile.', '') as keyof typeof StreamProfile;
    //     otherProfiles.push(StreamProfile[profile]);
    //   }
    // });
    const primaryProfile = StreamProfile.VIDEO_H264_530KBIT_L31;
    const otherProfiles = [StreamProfile.VIDEO_H264_530KBIT_L31, StreamProfile.VIDEO_H264_100KBIT_L30];
    this.ffmpegAudio && otherProfiles.push(StreamProfile.AUDIO_AAC);
    const request = {
      session_id: this.sessionID,
      profile: primaryProfile,
      other_profiles: otherProfiles,
    };
    const pbfContainer = new Pbf();
    StartPlayback.write(request, pbfContainer);
    const buffer = pbfContainer.finish();
    this.sendMessage(PacketType.START_PLAYBACK, buffer);
  }

  private sendStopPlayback(): void {
    const request = {
      session_id: this.sessionID,
    };
    const pbfContainer = new Pbf();
    StopPlayback.write(request, pbfContainer);
    const buffer = pbfContainer.finish();
    this.sendMessage(PacketType.STOP_PLAYBACK, buffer);
  }

  private sendAudioPayload(payload: Buffer): void {
    const request = {
      payload: payload,
      session_id: this.sessionID,
      codec: CodecType.SPEEX,
      sample_rate: 16e3, // Same as 16000
    };

    const pbfContainer = new Pbf();
    AudioPayload.write(request, pbfContainer);
    const buffer = pbfContainer.finish();
    this.sendMessage(PacketType.AUDIO_PAYLOAD, buffer);
  }

  private handleRedirect(payload: Pbf): void {
    const packet = Redirect.read(payload);
    if (packet.new_host) {
       console.log('[NexusStreamer] Redirecting...');
      this.host = packet.new_host;
      this.setupConnection();
      this.startPlayback();
    }
  }

  private handlePlaybackBegin(payload: Pbf): void {
    const packet = PlaybackBegin.read(payload);

    if (packet.session_id !== this.sessionID) {
      return;
    }

    for (let i = 0; i < packet.channels.length; i++) {
      const stream = packet.channels[`${i}`];
      if (stream.codec_type === CodecType.H264) {
        this.videoChannelID = stream.channel_id;
      } else if (stream.codec_type === CodecType.AAC) {
        this.audioChannelID = stream.channel_id;
      }
    }
  }

  private handlePlaybackPacket(payload: Pbf): void {
    const packet = PlaybackPacket.read(payload);
    if (packet.channel_id === this.videoChannelID) {
      // H264 NAL Units require 0001 added to beginning
      const startCode = Buffer.from([0x00, 0x00, 0x00, 0x01]);
      const stdin = this.ffmpegVideo.getStdin();
      if (stdin && !stdin?.destroyed) {
        stdin.write(Buffer.concat([startCode, Buffer.from(packet.payload)]));
      }
    }
    if (packet.channel_id === this.audioChannelID) {
      const stdin = this.ffmpegAudio?.getStdin();
      if (stdin && !stdin?.destroyed) {
        stdin.write(Buffer.from(packet.payload));
      }
    }
  }

  private handlePlaybackEnd(payload: Pbf): void {
    const packet = PlaybackEnd.read(payload);
    if (packet.reason === PlaybackEnd.Reason.ERROR_TIME_NOT_AVAILABLE && !this.started) {
      setTimeout(() => {
        this.startPlayback();
      }, 1000);
    }
  }

  private handleNexusError(payload: Pbf): void {
    const packet = Error.read(payload);
    if (packet.code === ErrorCode.ERROR_AUTHORIZATION_FAILED) {
       console.log('[NexusStreamer] Updating authentication');
      this.updateAuthentication();
    } else {
       console.log(`[NexusStreamer] Error: ${packet.message}`);
      this.stopPlayback();
    }
  }

  private handleNexusPacket(type: number, payload: Pbf): void {
    switch (type) {
      case PacketType.PING:
         console.log('[NexusStreamer] Ping');
        break;
      case PacketType.OK:
         console.log('[NexusStreamer] OK');
        this.authorized = true;
        this.processPendingMessages();
        break;
      case PacketType.ERROR:
        this.handleNexusError(payload);
        break;
      case PacketType.PLAYBACK_BEGIN:
         console.log('[NexusStreamer] Playback Begin');
        this.handlePlaybackBegin(payload);
        break;
      case PacketType.PLAYBACK_END:
         console.log('[NexusStreamer] Playback End');
        this.handlePlaybackEnd(payload);
        break;
      case PacketType.PLAYBACK_PACKET:
        //  console.log('[NexusStreamer] Playback Packet');
        this.handlePlaybackPacket(payload);
        break;
      case PacketType.LONG_PLAYBACK_PACKET:
        //  console.log('[NexusStreamer] Long Playback Packet');
        this.handlePlaybackPacket(payload);
        break;
      case PacketType.CLOCK_SYNC:
         console.log('[NexusStreamer] Clock Sync');
        break;
      case PacketType.REDIRECT:
         console.log('[NexusStreamer] Redirect');
        this.handleRedirect(payload);
        break;
      case PacketType.TALKBACK_BEGIN:
         console.log('[NexusStreamer] Talkback Begin');
        break;
      case PacketType.TALKBACK_END:
         console.log('[NexusStreamer] Talkback End');
        break;
      default:
         console.log('[NexusStreamer] Unhandled Type: ' + type);
    }
  }

  private handleNexusData(data: Buffer): void {
    if (this.pendingBuffer === void 0) {
      this.pendingBuffer = data;
    } else {
      this.pendingBuffer = Buffer.concat([this.pendingBuffer, data]);
    }

    const type = this.pendingBuffer.readUInt8();
    let headerLength = 0;
    let length = 0;
    if (type === PacketType.LONG_PLAYBACK_PACKET) {
      headerLength = 5;
      length = this.pendingBuffer.readUInt32BE(1);
    } else {
      headerLength = 3;
      length = this.pendingBuffer.readUInt16BE(1);
    }
    const payloadEndPosition = length + headerLength;
    if (this.pendingBuffer.length >= payloadEndPosition) {
      const rawPayload = this.pendingBuffer.slice(headerLength, payloadEndPosition);
      const payload = new Pbf(rawPayload);
      this.handleNexusPacket(type, payload);
      const remainingData = this.pendingBuffer.slice(payloadEndPosition);
      this.pendingBuffer = void 0;
      if (remainingData.length !== 0) {
        this.handleNexusData(remainingData);
      }
    }
  }
}
