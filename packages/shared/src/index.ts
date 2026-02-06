export interface ServerToClientEvents {
  handshake: (status: 'success' | 'error', errorMessage?: string) => void;
}

export interface ClientToServerEvents {
  handshake: (
    roomCode: string,
    role: 'host' | 'client' | 'audience',
    roomPassword?: string,
    hostKey?: string
  ) => void;
}
