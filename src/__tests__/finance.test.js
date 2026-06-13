/**
 * Finance controller unit tests.
 * The pg pool is mocked — no real database required.
 */
jest.mock('../config/db', () => {
  const mockClient = {
    query: jest.fn(),
    release: jest.fn(),
  };
  return {
    pool: {
      query: jest.fn(),
      connect: jest.fn().mockResolvedValue(mockClient),
    },
    _mockClient: mockClient,
  };
});

jest.mock('../controllers/smsController', () => ({
  triggerAutoReceipt: jest.fn().mockResolvedValue(undefined),
}));

const db = require('../config/db');
const { pool } = db;
const mockClient = db._mockClient;

const financeController = require('../controllers/financeController');

// ── helpers ───────────────────────────────────────────────────────────────────
function makeReq(body = {}, params = {}, user = { school_id: 1 }) {
  return { body, params, user, query: {} };
}
function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res;
}
const next = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  // Default: BEGIN / COMMIT succeed
  mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
});

// ── generateInvoice ───────────────────────────────────────────────────────────
describe('generateInvoice', () => {
  test('returns 400 when required fields are missing', async () => {
    const res = makeRes();
    await financeController.generateInvoice(makeReq({}), res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 400 when fees is not an array', async () => {
    const res = makeRes();
    await financeController.generateInvoice(
      makeReq({ student_id: 1, term_id: 1, fees: 'bad' }), res, next
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 400 when fees array is empty', async () => {
    const res = makeRes();
    await financeController.generateInvoice(
      makeReq({ student_id: 1, term_id: 1, fees: [] }), res, next
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 409 when invoice already exists', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })  // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 }) // assertStudentOwnership
      .mockResolvedValueOnce({ rows: [{ id: 99 }], rowCount: 1 }); // existingInvoice

    const res = makeRes();
    await financeController.generateInvoice(
      makeReq({ student_id: 1, term_id: 1, fees: [{ fee_name: 'Tuition', amount: 5000 }] }),
      res, next
    );
    expect(res.status).toHaveBeenCalledWith(409);
  });

  test('creates invoice and returns 201 on success', async () => {
    const fakeInvoice = { id: 10, total_amount: 5000, balance: 5000 };
    mockClient.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })              // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 })    // assertStudentOwnership
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })              // existingInvoice (none)
      .mockResolvedValueOnce({ rows: [{ balance: 0 }], rowCount: 1 }) // ledger balance
      .mockResolvedValueOnce({ rows: [fakeInvoice], rowCount: 1 })  // INSERT invoice
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })              // INSERT item
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })              // INSERT ledger
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });             // COMMIT

    const res = makeRes();
    await financeController.generateInvoice(
      makeReq({ student_id: 1, term_id: 1, fees: [{ fee_name: 'Tuition', amount: 5000 }] }),
      res, next
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(fakeInvoice);
  });

  test('previous balance is added to new term fees for finalBalance', async () => {
    // Previous ledger shows 2000 outstanding debt
    const fakeInvoice = { id: 11, total_amount: 5000, balance: 7000 };
    mockClient.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ balance: 2000 }], rowCount: 1 }) // ← 2000 debt
      .mockResolvedValueOnce({ rows: [fakeInvoice], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = makeRes();
    await financeController.generateInvoice(
      makeReq({ student_id: 1, term_id: 1, fees: [{ fee_name: 'Tuition', amount: 5000 }] }),
      res, next
    );

    // The INSERT invoice call should receive finalBalance = 5000 + 2000 = 7000
    const invoiceInsertCall = mockClient.query.mock.calls.find(
      call => typeof call[0] === 'string' && call[0].includes('INSERT INTO student_invoices')
    );
    expect(invoiceInsertCall).toBeDefined();
    expect(invoiceInsertCall[1][4]).toBe(7000); // $5 = finalBalance
  });

  test('rolls back and calls next(err) on database error', async () => {
    const dbError = new Error('DB connection failed');
    mockClient.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })           // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 }) // assertStudentOwnership
      .mockRejectedValueOnce(dbError);                            // existingInvoice throws

    const res = makeRes();
    await financeController.generateInvoice(
      makeReq({ student_id: 1, term_id: 1, fees: [{ fee_name: 'Tuition', amount: 5000 }] }),
      res, next
    );
    expect(next).toHaveBeenCalledWith(dbError);
  });
});

// ── postPayment ───────────────────────────────────────────────────────────────
describe('postPayment', () => {
  test('returns 400 when required fields are missing', async () => {
    const res = makeRes();
    await financeController.postPayment(makeReq({ student_id: 1 }), res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('records payment and returns 201 on success', async () => {
    const fakePayment = { id: 55, amount_paid: 3000 };
    mockClient.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })              // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 })    // assertStudentOwnership
      .mockResolvedValueOnce({ rows: [fakePayment], rowCount: 1 })  // INSERT payment
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });             // COMMIT

    const res = makeRes();
    await financeController.postPayment(
      makeReq({ student_id: 1, term_id: 1, amount: 3000, method: 'CASH', reference: 'REF001' }),
      res, next
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('returns 404 when student not in school', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // assertStudentOwnership fails

    const res = makeRes();
    await financeController.postPayment(
      makeReq({ student_id: 999, amount: 1000, reference: 'X' }),
      res, next
    );
    // assertStudentOwnership throws → next called with error
    expect(next).toHaveBeenCalled();
    const err = next.mock.calls[0][0];
    expect(err.status).toBe(404);
  });
});

// ── searchStudents ────────────────────────────────────────────────────────────
describe('searchStudents', () => {
  test('returns 400 when query is empty', async () => {
    const res = makeRes();
    await financeController.searchStudents(
      { query: {}, user: { school_id: 1 } }, res, next
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('filters results by school_id', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1, full_name: 'Alice' }] });

    const res = makeRes();
    await financeController.searchStudents(
      { query: { query: 'Alice' }, user: { school_id: 7 } }, res, next
    );

    const call = pool.query.mock.calls[0];
    expect(call[0]).toContain('school_id = $1');
    expect(call[1][0]).toBe(7); // school_id param
    expect(res.json).toHaveBeenCalledWith([{ id: 1, full_name: 'Alice' }]);
  });
});

// ── getGeneralAudit ───────────────────────────────────────────────────────────
describe('getGeneralAudit', () => {
  test('returns rows scoped to school', async () => {
    const fakeRows = [{ id: 1, full_name: 'Bob', amount_paid: 1000 }];
    pool.query.mockResolvedValueOnce({ rows: fakeRows });

    const res = makeRes();
    await financeController.getGeneralAudit(
      { user: { school_id: 3 } }, res, next
    );

    const call = pool.query.mock.calls[0];
    expect(call[1][0]).toBe(3);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(fakeRows);
  });
});
