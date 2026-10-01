import { Body, Controller, Get, HttpCode, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  updateProfileSchema,
} from '@nexa/shared';
import type { Response } from 'express';
import { Auth, Public, RateLimit } from '../common/decorators';
import type { AuthContext, NexaRequest } from '../common/request-context';
import { parse } from '../common/validation';
import { AuthService, ClientMeta } from './auth.service';
import { SessionService } from './session.service';

const meta = (req: NexaRequest): ClientMeta => ({
  ip: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
  requestId: req.id,
});

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  @Public()
  @Post('register')
  @RateLimit({ bucket: 'auth-register', limit: 10, windowSeconds: 3600, by: 'ip' })
  async register(
    @Body() body: unknown,
    @Req() req: NexaRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const s = await this.auth.register(parse(registerSchema, body), meta(req));
    res.cookie(this.sessions.cookieName, s.token, this.sessions.cookieOptions(s.expiresAt));
    return { ok: true };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @RateLimit({ bucket: 'auth-login', limit: 20, windowSeconds: 900, by: 'ip' })
  async login(
    @Body() body: unknown,
    @Req() req: NexaRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const s = await this.auth.login(parse(loginSchema, body), meta(req));
    res.cookie(this.sessions.cookieName, s.token, this.sessions.cookieOptions(s.expiresAt));
    return { ok: true };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Auth() ctx: AuthContext, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(ctx);
    res.clearCookie(this.sessions.cookieName, this.sessions.cookieOptions());
    return { ok: true };
  }

  @Get('me')
  me(@Auth() ctx: AuthContext, @Req() req: NexaRequest) {
    return this.auth.me(ctx, req.org?.orgId ?? null);
  }

  @Public()
  @Post('password-reset/request')
  @HttpCode(202)
  @RateLimit({ bucket: 'auth-reset', limit: 5, windowSeconds: 3600, by: 'ip' })
  async requestReset(@Body() body: unknown, @Req() req: NexaRequest) {
    await this.auth.requestPasswordReset(parse(requestPasswordResetSchema, body).email, meta(req));
    return { ok: true };
  }

  @Public()
  @Post('password-reset/confirm')
  @HttpCode(200)
  @RateLimit({ bucket: 'auth-reset-confirm', limit: 10, windowSeconds: 3600, by: 'ip' })
  async confirmReset(@Body() body: unknown, @Req() req: NexaRequest) {
    await this.auth.resetPassword(parse(resetPasswordSchema, body), meta(req));
    return { ok: true };
  }

  @Post('password')
  @HttpCode(200)
  @RateLimit({ bucket: 'auth-change-password', limit: 10, windowSeconds: 3600, by: 'user' })
  async changePassword(@Auth() ctx: AuthContext, @Body() body: unknown) {
    await this.auth.changePassword(ctx, parse(changePasswordSchema, body));
    return { ok: true };
  }

  @Patch('profile')
  async updateProfile(@Auth() ctx: AuthContext, @Body() body: unknown) {
    await this.auth.updateProfile(ctx, parse(updateProfileSchema, body).name);
    return { ok: true };
  }
}
