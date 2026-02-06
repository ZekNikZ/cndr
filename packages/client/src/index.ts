/**
 * Client library for cndr API
 */

import { type Socket, io } from 'socket.io-client';

import type { ClientToServerEvents, ServerToClientEvents } from '@cndr/shared';

export type ClientConfig = {
  baseUrl: string;

  roomCode: string;
  roomPassword?: string;

  role: 'host' | 'client' | 'audience';
  hostKey?: string;
};

export class CndrClient {
  private readonly baseUrl: string;
  private readonly roomCode: string;
  private readonly roomPassword?: string;
  private readonly role: 'host' | 'client' | 'audience';
  private readonly hostKey?: string;
  private readonly socket: Socket<ServerToClientEvents, ClientToServerEvents>;

  private isConnected = false;

  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl;
    this.roomCode = config.roomCode;
    this.roomPassword = config.roomPassword;
    this.hostKey = config.hostKey;
    this.role = config.role;

    this.socket = io(this.baseUrl);
    this.configureSocket();

    this.connect();
  }

  private async configureSocket() {
    // Configure socket event listeners here
    this.socket.on('handshake', (status, errorMessage) => {
      if (status === 'success') {
        this.isConnected = true;
      } else {
        throw new Error(`Handshake failed: ${errorMessage}`);
      }
    });
  }

  public async connect() {
    if (this.isConnected) {
      return;
    }

    // Handshake with the server
    this.socket.emit('handshake', this.roomCode, this.role, this.roomPassword, this.hostKey);
  }
}
