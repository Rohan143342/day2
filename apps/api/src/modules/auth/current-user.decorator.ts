import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedUser } from './jwt-auth.guard';

export const CurrentUser = createParamDecorator((_: unknown, context: ExecutionContext): AuthenticatedUser => {
  const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
  if (!request.user) throw new Error('CurrentUser used on a route without authentication');
  return request.user;
});
