import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { type ClientGrpc } from '@nestjs/microservices';
import { GrpcBreaker } from '../grpc/grpc-breaker.service.js';

type ValidateResult = { valid: boolean; user_id: string; name: string };

@Injectable()
export class AuthClient implements OnModuleInit {
  private authService: any;

  constructor(
    @Inject('AUTH') private readonly client: ClientGrpc,
    private readonly grpc: GrpcBreaker,
  ) {}

  onModuleInit() {
    this.authService = this.client.getService('AuthService');
  }

  validate(token: string): Promise<ValidateResult> {
    return this.grpc.call('auth.validateToken', () => this.authService.validateToken({ access_token: token }));
  }
}
