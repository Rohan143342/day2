import { CanActivate, ExecutionContext, HttpStatus, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { AppException, ErrorCode } from '../../common/errors';
import { requestContext } from '../../common/request-context';
import { PrismaService } from '../../prisma/prisma.service';

export const PUBLIC_KEY = 'isPublic';
export const Public = (): MethodDecorator => SetMetadata(PUBLIC_KEY, true);

export interface AuthenticatedUser {
  userId: string;
  sessionId: string;
  deviceId: string;
}

/**
 * Authentication is deny-by-default: a route is only reachable unauthenticated
 * if it is explicitly marked @Public(). The session is re-checked against the
 * database on every request so a revoked device loses access immediately rather
 * than when its access token expires.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.get<boolean>(PUBLIC_KEY, context.getHandler())) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const header = request.header('authorization');
    if (!header?.startsWith('Bearer ')) throw this.unauthenticated();

    let payload: { sub: string; sid: string; did: string };
    try {
      payload = await this.jwt.verifyAsync(header.slice('Bearer '.length));
    } catch {
      throw this.unauthenticated();
    }

    const session = await this.prisma.session.findUnique({
      where: { id: payload.sid },
      select: { userId: true, revokedAt: true, expiresAt: true, deviceId: true },
    });
    if (!session || session.revokedAt || session.userId !== payload.sub || session.expiresAt.getTime() < Date.now()) {
      throw this.unauthenticated();
    }

    request.user = { userId: payload.sub, sessionId: payload.sid, deviceId: session.deviceId };
    requestContext.setUserId(payload.sub);
    return true;
  }

  private unauthenticated(): AppException {
    return new AppException(ErrorCode.UNAUTHENTICATED, 'Please sign in to continue.', HttpStatus.UNAUTHORIZED);
  }
}
