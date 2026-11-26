# 🏠 Casa em Ordem

Aplicativo web responsivo (PWA) para gerenciamento colaborativo de tarefas domésticas em tempo real, desenvolvido com **HTML5, CSS3 e JavaScript puro** integrado a um banco de dados relacional **PostgreSQL no Supabase**.

---

## ✨ Funcionalidades

### 📋 Afazeres (Pendentes)
- **Organização por responsável, data e turno:** atribuição de tarefas por morador com identificação visual por cores, data prevista e turno (*Manhã*, *Tarde*, *Noite* ou *Qualquer hora*).
- **Alertas de atraso:** destaque automático para tarefas pendentes com data anterior ao dia atual (atualiza sozinho na virada do dia, mesmo com o app aberto).
- **Troca rápida em 1 toque:** clique na etiqueta do responsável dentro do cartão para reatribuir a tarefa sem abrir a edição.
- **Subtarefas (Checklist):** divisão de tarefas maiores em etapas com acompanhamento de progresso.
- **Observações:** campo de notas em cada tarefa (ex.: *"usar o produto do armário de cima"*).
- **Pontos por esforço:** cada tarefa vale 1, 2, 3 ou 5 pontos; o placar semanal soma pontos, deixando a divisão mais justa.
- **Filtros dinâmicos:** pesquisa por nome, filtros por morador com contador de pendências, por cômodo e por status (*Todos*, *Atrasadas*, *Hoje*).

### 🔁 Repetição automática
Ao concluir uma tarefa recorrente, a próxima ocorrência (com suas subtarefas) é criada automaticamente:
- **Diária**, **Semanal** (7 dias), **Quinzenal** (14 dias) e **Mensal** (mesmo dia do mês, ajustando em meses mais curtos);
- **Dias da semana específicos** (ex.: segunda, quarta e sexta);
- **⚖️ Rodízio:** a cada repetição a tarefa passa para a próxima pessoa da casa (ex.: o lixo alterna entre os moradores);
- Desmarcar e marcar de novo **não** gera repetição duplicada.

### 🗓️ Semana
- Visão dos próximos 7 dias em colunas, com navegação entre semanas.
- **Arraste e solte** tarefas entre dias (no celular, use as setas ◀ ▶ do cartão).
- Tarefas atrasadas aparecem na coluna de hoje.

### 🛒 Lista de Compras
- Lista compartilhada e sincronizada ao vivo, com quantidade opcional.
- Registra quem pediu e quem comprou cada item; botão para limpar os itens já comprados.

### ✅ Concluídos
- **Histórico organizado:** as **10 tarefas finalizadas mais recentes**, com quem concluiu, data/hora e pontos, e opção de carregar mais.
- **Pesquisa no histórico:** filtros por **nome**, **cômodo** ou **quem realizou**.

### 📊 Estatísticas e Gráficos
- **KPIs:** tarefas a fazer, total concluído, pendências atrasadas e entregas dos últimos 7 dias.
- **Gráficos (Chart.js):** status geral (rosca), divisão por pessoa (barras empilhadas) e ritmo semanal (barras).
- **Progresso por cômodo:** percentual de conclusão em cada ambiente.

### 🔔 Lembretes
- Resumo diário no horário escolhido com as suas tarefas do dia e as atrasadas.
- Aviso quando alguém passa uma tarefa para você (com o app em segundo plano).
- Configurado por aparelho, em **Configurações → Lembretes**.

> **Limitação:** os lembretes são disparados pelo próprio app, então funcionam com ele aberto ou em segundo plano. Para receber notificações com o app **totalmente fechado** é preciso um servidor de *Web Push* (por exemplo, uma Edge Function do Supabase com agendamento). No iPhone, as notificações só funcionam com o app instalado na tela inicial.

### ⚙️ Configurações e experiência
- **Login por link mágico:** só entra quem foi convidado; os dados ficam protegidos por *Row Level Security*.
- **"Quem está usando":** define em nome de quem as tarefas são concluídas. É selecionado automaticamente se o e-mail do login estiver vinculado ao morador.
- **Gestão de moradores e cômodos** com cores, ícones e e-mail de login.
- **Sincronização ao vivo (Supabase Realtime)** entre todos os aparelhos.
- **Tema claro/escuro** e **PWA instalável**, com funcionamento offline da interface (service worker).

---

## 🚀 Como configurar

### 1. Banco de dados (Supabase)
1. Crie um projeto em [supabase.com](https://supabase.com/) (ou use o existente).
2. Abra o **SQL Editor**, cole o conteúdo de [`supabase/schema.sql`](supabase/schema.sql) e execute.
   - Em um projeto novo, ele cria todas as tabelas.
   - Em um projeto existente, ele só adiciona o que falta: **nenhum dado é apagado**, mas as políticas de acesso antigas são substituídas por políticas que exigem login.
3. Em `app.js`, ajuste `SUPABASE_URL` e `SUPABASE_KEY` (chave *publishable/anon*, que pode ficar no código porque o acesso é controlado pelo RLS).

### 2. Login (Supabase Auth)
1. Em **Authentication → Sign In / Providers**, mantenha **Email** ativo e **desative "Allow new users to sign up"**. Assim, só pessoas convidadas conseguem entrar.
2. Em **Authentication → Users → Invite user**, convide o e-mail de cada morador.
3. Em **Authentication → URL Configuration**, coloque o endereço do app (ex.: `https://alissu28.github.io/gestao-residencial/`) em **Site URL** e em **Redirect URLs**.
4. No app, em **Configurações → Pessoas da Casa**, vincule o e-mail de cada morador (botão ✉️) para que o app reconheça quem está usando.

### 3. Publicação (GitHub Pages)
Em **Settings → Pages** do repositório, escolha *Deploy from a branch*, branch `main` e pasta `/ (root)`.

---

## 🛠️ Tecnologias Utilizadas

- **Frontend:** HTML5, CSS3 (Grid, Flexbox, Variáveis CSS), JavaScript (ES6+)
- **Gráficos:** [Chart.js](https://www.chartjs.org/) 4.6.2
- **Backend / Banco de Dados:** [Supabase](https://supabase.com/) (PostgreSQL, PostgREST, Auth, Row Level Security e Realtime) via supabase-js 2.119.2
- **PWA:** Web App Manifest + Service Worker
- **Hospedagem:** GitHub Pages

---

## 📁 Estrutura do Projeto

```text
gestao-residencial/
├── index.html          # Estrutura das abas, formulários, login e canvas dos gráficos
├── style.css           # Estilização responsiva, barra lateral retrátil e temas claro/escuro
├── app.js              # Lógica da aplicação, login, CRUD, Realtime, semana, compras, lembretes e gráficos
├── sw.js               # Service worker (cache offline e clique nas notificações)
├── manifest.json       # Configurações de PWA para instalação no celular e desktop
├── icons/              # Ícones do app (PNG, SVG e apple-touch-icon)
├── supabase/
│   └── schema.sql      # Tabelas, view do placar, segurança (RLS) e Realtime
├── LICENSE
└── README.md
```

---

## 📄 Licença

Distribuído sob a licença MIT. Veja [`LICENSE`](LICENSE).
