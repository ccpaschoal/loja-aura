-- AURA · banco D1 dos pedidos

CREATE TABLE pedidos (
  id TEXT PRIMARY KEY,              -- AU + 8 caracteres
  criado_em INTEGER NOT NULL,
  status TEXT NOT NULL,             -- pagamento: pendente | pago | conferir | estornado | whatsapp | falhou
  etapa TEXT NOT NULL DEFAULT 'novo', -- entrega: novo | comprado | enviado | entregue | cancelado
  cor TEXT NOT NULL,
  qtd INTEGER NOT NULL,
  forma TEXT NOT NULL,              -- pix (Pix/boleto, com desconto) | cartao
  valor REAL NOT NULL,
  nome TEXT NOT NULL,
  email TEXT NOT NULL,
  cpf TEXT NOT NULL,
  whatsapp TEXT NOT NULL,
  cep TEXT NOT NULL,
  endereco TEXT NOT NULL,           -- JSON: rua, numero, complemento, bairro, cidade, uf
  preferencia_id TEXT,
  pagamento_id TEXT,
  metodo TEXT,
  valor_pago REAL,
  pago_em INTEGER,
  ali_pedido TEXT,                  -- número do pedido no AliExpress
  rastreio TEXT,
  obs TEXT,
  ambiente TEXT,
  ip_hash TEXT
);
CREATE INDEX pedidos_criado ON pedidos (criado_em);
CREATE INDEX pedidos_ip ON pedidos (ip_hash, criado_em);

-- Trava para não avisar duas vezes o mesmo pagamento
CREATE TABLE alertas (chave TEXT PRIMARY KEY, em INTEGER NOT NULL);

-- Tentativas de senha do painel (só o resumo do IP)
CREATE TABLE tentativas (ip_hash TEXT NOT NULL, em INTEGER NOT NULL);
CREATE INDEX tentativas_ip ON tentativas (ip_hash, em);
