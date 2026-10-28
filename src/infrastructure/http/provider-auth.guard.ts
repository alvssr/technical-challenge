import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

@Injectable()
export class ProviderAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expectedToken = process.env.API_BEARER_TOKEN;
    if (!expectedToken || expectedToken.length < 32) {
      throw new ServiceUnavailableException(
        'Autenticação da API não está configurada corretamente.',
      );
    }

    const request = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | undefined> }>();
    const authorization = request.headers.authorization;
    const suppliedToken = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : '';
    const expected = Buffer.from(expectedToken);
    const supplied = Buffer.from(suppliedToken);

    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      throw new UnauthorizedException('Credencial inválida.');
    }

    return true;
  }
}
