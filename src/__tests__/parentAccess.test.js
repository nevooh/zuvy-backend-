jest.mock('../config/db', () => ({
  query: jest.fn(),
  pool: {
    query: jest.fn(),
  },
}));

jest.mock('../services/mpesaService', () => ({
  initiateFeeSTKPush: jest.fn(),
}));

jest.mock('../controllers/smsController', () => ({
  triggerAutoReceipt: jest.fn().mockResolvedValue(undefined),
}));

const db = require('../config/db');
const { pool } = db;
const MpesaService = require('../services/mpesaService');
const ledgerController = require('../controllers/studentFinanceLedgerController');
const paymentController = require('../controllers/parentPaymentController');

const testSchoolId = '11111111-1111-4111-8111-111111111111';
const ownStudentId = '22222222-2222-4222-8222-222222222222';
const otherStudentId = '33333333-3333-4333-8333-333333333333';
const parentPhone = '0712345678';

function makeParentReq({ params = {}, body = {} } = {}) {
  return {
    params,
    body,
    school_id: testSchoolId,
    user: {
      role: 'parent',
      phoneNumber: parentPhone,
      school_id: testSchoolId,
      schoolId: testSchoolId,
    },
  };
}

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res;
}

const next = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockReset();
  pool.query.mockReset();
});

describe('parent finance data isolation', () => {
  test('allows a parent to read their own child ledger', async () => {
    db.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: ownStudentId }] })
      .mockResolvedValueOnce({
        rows: [{
          student_id: ownStudentId,
          full_name: 'Amina Otieno',
          current_outstanding_balance: 1200,
        }],
      });

    const res = makeRes();

    await ledgerController.getStudentPremiumLedger(
      makeParentReq({ params: { studentId: ownStudentId } }),
      res,
      next
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ student_id: ownStudentId }),
    }));
  });

  test('blocks a parent from reading another student ledger in the same school', async () => {
    db.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const res = makeRes();

    await ledgerController.getStudentPremiumLedger(
      makeParentReq({ params: { studentId: otherStudentId } }),
      res,
      next
    );

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      status: 403,
      message: 'Access denied',
    }));
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalledWith(200);
  });
});

describe('parent payment ownership checks', () => {
  test('blocks STK push for a student not owned by the logged-in parent', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const res = makeRes();

    await paymentController.initiateFeePayment(
      makeParentReq({
        body: {
          student_id: otherStudentId,
          amount: 1500,
          phone: parentPhone,
        },
      }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(MpesaService.initiateFeeSTKPush).not.toHaveBeenCalled();
  });

  test('starts STK push for the parent own child using realistic fake data', async () => {
    pool.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: ownStudentId }] })
      .mockResolvedValueOnce({ rows: [{ settlement_paybill: '522522' }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    MpesaService.initiateFeeSTKPush.mockResolvedValueOnce({
      data: { CheckoutRequestID: 'ws_CO_110620261234567890' },
    });

    const res = makeRes();

    await paymentController.initiateFeePayment(
      makeParentReq({
        body: {
          student_id: ownStudentId,
          amount: 1500,
          phone: parentPhone,
        },
      }),
      res
    );

    expect(MpesaService.initiateFeeSTKPush).toHaveBeenCalledWith(
      1500,
      '254712345678',
      ownStudentId,
      testSchoolId
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('rejects invalid checkout amount', async () => {
    const res = makeRes();

    await paymentController.getCheckoutSummary(
      makeParentReq({ body: { amount: -50 } }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
  });
});
