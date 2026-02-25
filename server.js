

const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;


app.use(cors());
app.use(express.json());

const signals = [];

const executedBySlave = new Map(); 


let nextSignalId = 1;

function generateSignalId(signal) {
  return `sig_${signal.master_id}_${signal.ticket}_${signal.action}_${Date.now()}`;
}


function markAsExecuted(slaveId, signalId) {
  if (!executedBySlave.has(slaveId)) {
    executedBySlave.set(slaveId, new Set());
  }
  executedBySlave.get(slaveId).add(signalId);
}

function wasExecuted(slaveId, signalId) {
  return executedBySlave.has(slaveId) && executedBySlave.get(slaveId).has(signalId);
}


function getPendingSignals(slaveId) {
  return signals.filter(s => !wasExecuted(slaveId, s.id));
}


app.post('/signal', (req, res) => {
  try {
    const {
      master_id,
      ticket,
      symbol,
      type,
      lot,
      open_price,
      sl,
      tp,
      action
    } = req.body;

    if (!master_id || !ticket || !action) {
      return res.status(400).json({
        success: false,
        error: 'Campos obrigatórios: master_id, ticket, action'
      });
    }

    if (!['OPEN', 'CLOSE', 'MODIFY'].includes(action)) {
      return res.status(400).json({
        success: false,
        error: 'action deve ser OPEN, CLOSE ou MODIFY'
      });
    }

    const needsSymbol = action === 'OPEN' || action === 'MODIFY';
    if (needsSymbol && !symbol) {
      return res.status(400).json({
        success: false,
        error: 'Campo symbol é obrigatório quando action é OPEN ou MODIFY'
      });
    }

    const signal = {
      id: generateSignalId(req.body),
      master_id: String(master_id),
      ticket: Number(ticket),
      symbol: symbol != null && symbol !== '' ? String(symbol) : null,
      type: type || 'BUY',
      lot: parseFloat(lot) ?? 0.01,
      open_price: parseFloat(open_price) ?? 0,
      sl: parseFloat(sl) ?? 0,
      tp: parseFloat(tp) ?? 0,
      action: action,
      created_at: new Date().toISOString()
    };

    signals.push(signal);

    console.log(`[SIGNAL] Recebido: ${signal.action} ${signal.symbol ?? '(sem symbol)'} ticket=${signal.ticket} id=${signal.id}`);

    res.json({ success: true, signal_id: signal.id });
  } catch (err) {
    console.error('[ERROR] POST /signal:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});


app.get('/signal/:slaveId', (req, res) => {
  try {
    const slaveId = req.params.slaveId;

    if (!slaveId) {
      return res.status(400).json({ success: false, error: 'slaveId obrigatório' });
    }

    const pending = getPendingSignals(slaveId);

    res.json({
      success: true,
      signals: pending,
      count: pending.length
    });
  } catch (err) {
    console.error('[ERROR] GET /signal/:slaveId:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/signal/:slaveId/executed', (req, res) => {
  try {
    const slaveId = req.params.slaveId;
    const { signal_id } = req.body;

    if (!slaveId || !signal_id) {
      return res.status(400).json({ success: false, error: 'slaveId e signal_id obrigatórios' });
    }

    markAsExecuted(slaveId, signal_id);

    res.json({ success: true });
  } catch (err) {
    console.error('[ERROR] POST /signal/:slaveId/executed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(JSON.stringify({
    event: 'server_started',
    msg: 'Trade Copier API ready',
    port: PORT,
    host: HOST,
    endpoints: {
      signal: 'POST /signal',
      pending: 'GET /signal/:slaveId',
      executed: 'POST /signal/:slaveId/executed',
      health: 'GET /health'
    }
  }));
});
