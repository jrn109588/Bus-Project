import './style.css'
import { supabase } from './supabase.js'

const $ = (s) => document.querySelector(s)
const esc = (t = '') =>
  String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

let user = null
let rotas = []
let editando = null

const aviso = (texto, erro = false) => {
  const el = $('#msg')
  el.textContent = texto
  el.className = erro ? 'erro' : 'ok'
}

/* ---------- 2. AUTENTICAÇÃO: cadastro, login, logout, sessão ---------- */
async function iniciar() {
  const { data } = await supabase.auth.getSession() // verificação de sessão
  user = data.session?.user ?? null

  supabase.auth.onAuthStateChange((_evento, sessao) => {
    user = sessao?.user ?? null
    renderAuth()
    renderForm()
    renderLista()
  })

  renderAuth()
  renderForm()
  await carregar()

  /* ---------- 5. REALTIME: lista atualiza sem refresh ---------- */
  supabase
    .channel('rotas-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rotas' }, carregar)
    .subscribe()
}

function renderAuth() {
  const area = $('#auth-area')
  if (user) {
    area.innerHTML = `<span>${esc(user.email)}</span> <button id="sair">Sair</button>`
    $('#sair').onclick = async () => {
      await supabase.auth.signOut()
      aviso('Você saiu da conta.')
    }
    return
  }
  area.innerHTML = `
    <form id="form-auth">
      <input type="email" name="email" placeholder="E-mail" required />
      <input type="password" name="senha" placeholder="Senha (mín. 6)" minlength="6" required />
      <button type="submit" data-modo="login">Entrar</button>
      <button type="submit" data-modo="cadastro" class="sec">Cadastrar</button>
    </form>`
  $('#form-auth').onsubmit = async (e) => {
    e.preventDefault()
    const modo = e.submitter.dataset.modo
    const { email, senha } = Object.fromEntries(new FormData(e.target))
    const { error } =
      modo === 'cadastro'
        ? await supabase.auth.signUp({ email, password: senha })
        : await supabase.auth.signInWithPassword({ email, password: senha })
    if (error) return aviso(error.message, true)
    aviso(modo === 'cadastro' ? 'Cadastro feito! Confirme o e-mail se solicitado.' : 'Login realizado!')
  }
}

/* ---------- 1. BANCO DE DADOS: CRUD ---------- */
async function carregar() {
  const { data, error } = await supabase.from('rotas').select('*').order('nome') // READ
  if (error) return aviso(error.message, true)
  rotas = data
  renderLista()
}

function renderForm() {
  const sec = $('#form-rota')
  sec.hidden = !user
  if (!user) return
  const r = rotas.find((x) => x.id === editando) ?? {}
  sec.innerHTML = `
    <h2>${editando ? 'Editar rota' : 'Nova rota'}</h2>
    <form id="form">
      <input name="nome" placeholder="Nome da rota (ex.: Centro → Campus)" value="${esc(r.nome)}" required />
      <input name="origem" placeholder="Origem" value="${esc(r.origem)}" required />
      <input name="destino" placeholder="Destino" value="${esc(r.destino)}" required />
      <input name="horarios" placeholder="Horários separados por vírgula: 06:30, 12:00, 18:15" value="${esc((r.horarios ?? []).join(', '))}" required />
      <input name="whatsapp_url" type="url" placeholder="Link do grupo no WhatsApp (opcional)" value="${esc(r.whatsapp_url)}" />
      <label>Tabela de horários (PDF ou imagem, opcional)
        <input name="arquivo" type="file" accept="application/pdf,image/*" />
      </label>
      <button type="submit">${editando ? 'Salvar' : 'Adicionar'}</button>
      ${editando ? '<button type="button" id="cancelar" class="sec">Cancelar</button>' : ''}
    </form>`
  $('#cancelar')?.addEventListener('click', () => { editando = null; renderForm() })
  $('#form').onsubmit = salvar
}

async function salvar(e) {
  e.preventDefault()
  const f = new FormData(e.target)
  const atual = rotas.find((x) => x.id === editando)
  const dados = {
    nome: f.get('nome').trim(),
    origem: f.get('origem').trim(),
    destino: f.get('destino').trim(),
    horarios: f.get('horarios').split(',').map((h) => h.trim()).filter(Boolean),
    whatsapp_url: f.get('whatsapp_url').trim() || null,
  }

  /* ---------- 3. STORAGE: upload ---------- */
  const arquivo = f.get('arquivo')
  if (arquivo && arquivo.size > 0) {
    const nomeSeguro = arquivo.name.replace(/[^\w.-]/g, '_')
    const caminho = `${user.id}/${Date.now()}-${nomeSeguro}`
    const { error } = await supabase.storage.from('horarios').upload(caminho, arquivo)
    if (error) return aviso('Erro no upload: ' + error.message, true)
    if (atual?.arquivo_path) await supabase.storage.from('horarios').remove([atual.arquivo_path])
    dados.arquivo_path = caminho
  }

  const { error } = editando
    ? await supabase.from('rotas').update(dados).eq('id', editando) // UPDATE
    : await supabase.from('rotas').insert(dados) // CREATE
  if (error) return aviso(error.message, true)

  aviso(editando ? 'Rota atualizada!' : 'Rota criada!')
  editando = null
  renderForm()
  carregar()
}

async function apagar(id) {
  const r = rotas.find((x) => x.id === id)
  if (!confirm(`Apagar a rota "${r.nome}"?`)) return
  const { error } = await supabase.from('rotas').delete().eq('id', id) // DELETE
  if (error) return aviso(error.message, true)
  if (r.arquivo_path) await supabase.storage.from('horarios').remove([r.arquivo_path])
  aviso('Rota apagada.')
}

function renderLista() {
  const termo = $('#busca').value.toLowerCase()
  const filtradas = rotas.filter((r) => `${r.nome} ${r.origem} ${r.destino}`.toLowerCase().includes(termo))
  if (!filtradas.length) {
    $('#lista').innerHTML = '<p class="vazio">Nenhuma rota encontrada.</p>'
    return
  }
  $('#lista').innerHTML = filtradas
    .map((r) => {
      /* STORAGE: download/recuperação via URL pública */
      const url = r.arquivo_path
        ? supabase.storage.from('horarios').getPublicUrl(r.arquivo_path).data.publicUrl
        : null
      const dono = user && r.user_id === user.id
      return `
      <article class="card">
        <h3>${esc(r.nome)}</h3>
        <p class="trajeto">${esc(r.origem)} → ${esc(r.destino)}</p>
        <p class="horarios">${r.horarios.map((h) => `<span>${esc(h)}</span>`).join('')}</p>
        <p class="links">
          ${r.whatsapp_url ? `<a href="${esc(r.whatsapp_url)}" target="_blank" rel="noopener">💬 Grupo no WhatsApp</a>` : '<em>Sem grupo no WhatsApp</em>'}
          ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener" download>📄 Tabela de horários</a>` : ''}
        </p>
        ${dono ? `<div class="acoes"><button data-editar="${r.id}" class="sec">Editar</button><button data-apagar="${r.id}" class="perigo">Apagar</button></div>` : ''}
      </article>`
    })
    .join('')
}

$('#busca').addEventListener('input', renderLista)
$('#lista').addEventListener('click', (e) => {
  const { editar, apagar: id } = e.target.dataset
  if (editar) { editando = editar; renderForm(); scrollTo({ top: 0, behavior: 'smooth' }) }
  if (id) apagar(id)
})

iniciar()
