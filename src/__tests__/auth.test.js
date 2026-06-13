jest.mock('../config/db', () => ({
  query: jest.fn(),
}));

jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
}));

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn().mockReturnValue('mock.jwt.token'),
}));

const db     = require('../config/db');
const bcrypt = require('bcryptjs');
const { login } = require('../controllers/authController');

function makeReq(body = {}) { return { body }; }
function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res;
}
const next = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  process.env.JWT_SECRET = 'testsecret';
});

describe('login', () => {
  test('returns 400 when email is missing', async () => {
    const res = makeRes();
    await login(makeReq({ password: 'abc' }), res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 400 when password is missing', async () => {
    const res = makeRes();
    await login(makeReq({ email: 'a@b.com' }), res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 401 when user not found', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();
    await login(makeReq({ email: 'x@x.com', password: 'pass' }), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('returns 401 when password does not match', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: 1, password: 'hashed', school_active: true }],
    });
    bcrypt.compare.mockResolvedValueOnce(false);
    const res = makeRes();
    await login(makeReq({ email: 'a@b.com', password: 'wrong' }), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('returns 403 when school is inactive', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: 1, password: 'hashed', school_active: false }],
    });
    bcrypt.compare.mockResolvedValueOnce(true);
    const res = makeRes();
    await login(makeReq({ email: 'a@b.com', password: 'pass' }), res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns token and user on successful login', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        id: 1, full_name: 'Alice', role: 'admin',
        school_id: 5, password: 'hashed', school_active: true,
      }],
    });
    bcrypt.compare.mockResolvedValueOnce(true);
    const res = makeRes();
    await login(makeReq({ email: 'alice@school.com', password: 'correct' }), res, next);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      token: 'mock.jwt.token',
      user:  expect.objectContaining({ name: 'Alice', role: 'admin' }),
    }));
  });

  test('normalises email to lowercase before querying', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();
    await login(makeReq({ email: 'ALICE@School.COM', password: 'pass' }), res, next);
    expect(db.query.mock.calls[0][1][0]).toBe('alice@school.com');
  });

  test('calls next(err) on unexpected database error', async () => {
    db.query.mockRejectedValueOnce(new Error('DB down'));
    const res = makeRes();
    await login(makeReq({ email: 'a@b.com', password: 'pass' }), res, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});
