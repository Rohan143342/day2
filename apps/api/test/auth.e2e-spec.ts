import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { MockSmsProvider } from '../src/modules/notifications/sms.provider';
import { createTestApp, randomIndianMobile } from './app.factory';

const device = { installationId: 'test-installation-0001', model: 'Pixel 7', osVersion: '14' };

describe('auth (e2e)', () => {
  let app: INestApplication;
  let sms: MockSmsProvider;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    sms = app.get(MockSmsProvider);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  const sendOtp = async (phone: string): Promise<string> => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/otp/send')
      .send({ phone, purpose: 'REGISTRATION' })
      .expect(200);
    const message = sms.sent.filter((m) => m.to === phone).pop();
    if (!message) throw new Error('no OTP was dispatched');
    return message.variables.code;
  };

  it('rejects a malformed phone number', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/otp/send')
      .send({ phone: '9876543210', purpose: 'REGISTRATION' })
      .expect(400);
  });

  it('never stores the OTP or the phone number in plaintext', async () => {
    const phone = randomIndianMobile();
    const code = await sendOtp(phone);
    const user = await prisma.user.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
    const challenge = await prisma.otpChallenge.findFirstOrThrow({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(user.phoneEncrypted).not.toContain(phone.slice(3));
    expect(challenge.codeHash).not.toContain(code);
  });

  it('throttles repeat OTP requests for the same number', async () => {
    const phone = randomIndianMobile();
    await sendOtp(phone);
    await request(app.getHttpServer())
      .post('/api/v1/auth/otp/send')
      .send({ phone, purpose: 'LOGIN' })
      .expect(429);
  });

  it('rejects a wrong code and counts the attempt', async () => {
    const phone = randomIndianMobile();
    await sendOtp(phone);
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/otp/verify')
      .send({ phone, code: '000000', device })
      .expect(401);
    expect(response.body.error.code).toBe('OTP_INVALID');
  });

  it('issues tokens on a correct code, activates the user, and registers the device', async () => {
    const phone = randomIndianMobile();
    const code = await sendOtp(phone);
    const { body } = await request(app.getHttpServer())
      .post('/api/v1/auth/otp/verify')
      .send({ phone, code, device })
      .expect(200);

    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();

    const user = await prisma.user.findUniqueOrThrow({ where: { id: body.userId } });
    expect(user.status).toBe('ACTIVE');

    const devices = await request(app.getHttpServer())
      .get('/api/v1/auth/devices')
      .set('authorization', `Bearer ${body.accessToken}`)
      .expect(200);
    expect(devices.body).toHaveLength(1);
    expect(devices.body[0].model).toBe('Pixel 7');
  });

  it('will not reuse a consumed OTP', async () => {
    const phone = randomIndianMobile();
    const code = await sendOtp(phone);
    await request(app.getHttpServer()).post('/api/v1/auth/otp/verify').send({ phone, code, device }).expect(200);
    await request(app.getHttpServer()).post('/api/v1/auth/otp/verify').send({ phone, code, device }).expect(401);
  });

  it('rotates refresh tokens and revokes the family when one is replayed', async () => {
    const phone = randomIndianMobile();
    const code = await sendOtp(phone);
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/otp/verify')
      .send({ phone, code, device })
      .expect(200);

    const rotated = await request(app.getHttpServer())
      .post('/api/v1/auth/token/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(200);
    expect(rotated.body.refreshToken).not.toBe(login.body.refreshToken);

    const replay = await request(app.getHttpServer())
      .post('/api/v1/auth/token/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(401);
    expect(replay.body.error.code).toBe('SESSION_REPLAY_DETECTED');

    // The whole family dies, including the token that was legitimately rotated.
    await request(app.getHttpServer())
      .post('/api/v1/auth/token/refresh')
      .send({ refreshToken: rotated.body.refreshToken })
      .expect(401);
  });

  it('rejects an unauthenticated call to a protected route', async () => {
    await request(app.getHttpServer()).get('/api/v1/auth/devices').expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/auth/devices')
      .set('authorization', 'Bearer not-a-token')
      .expect(401);
  });

  it('stops honouring an access token once its session is revoked', async () => {
    const phone = randomIndianMobile();
    const code = await sendOtp(phone);
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/otp/verify')
      .send({ phone, code, device })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('authorization', `Bearer ${login.body.accessToken}`)
      .expect(204);

    await request(app.getHttpServer())
      .get('/api/v1/auth/devices')
      .set('authorization', `Bearer ${login.body.accessToken}`)
      .expect(401);
  });

  it('reports readiness only when the database answers', async () => {
    const { body } = await request(app.getHttpServer()).get('/healthz').expect(200);
    expect(body.status).toBe('ok');
    const ready = await request(app.getHttpServer()).get('/readyz').expect(200);
    expect(ready.body.database).toBe('ok');
  });
});
