import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthClient } from '../auth/auth-client.service.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authClient: AuthClient) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // This guard checks HTTP bearer tokens only; RabbitMQ events are not user requests.
    if (context.getType() !== 'http') return true;

    const request = context.switchToHttp().getRequest();
    const [type, token] = (request.headers.authorization ?? '').split(' ');

    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException('Missing access token');
    }

    // throws 503 when auth-service is down (circuit breaker), 401 only for a bad token
    const result = await this.authClient.validate(token);

    if (!result.valid) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    request.user = { id: result.user_id, name: result.name };
    return true;
  }
}
