if (!window.api) {
    alert("⚠️ ALERTA: O sistema foi aberto no navegador comum!\nPara o banco de dados funcionar corretamente, feche o navegador e inicie o aplicativo através do executável (Electron).");
}

const form = document.getElementById('venda-form');
const tableBody = document.getElementById('vendas-tbody');

let filtroStatus = 'todos';
let ordemCampo = 'data';
let ordemDirecao = 'desc';
let dadosAtuaisGlobais = {};
let timeoutBusca;
let driveConectado = false;

function toggleSidebar() {
    const isCollapsed = document.body.classList.toggle('sidebar-collapsed');
    const icon = document.getElementById('sidebar-icon');
    const label = document.getElementById('sidebar-label');
    if (isCollapsed) {
        icon.innerText = '▶';
        label.innerText = 'Mostrar Lateral';
    } else {
        icon.innerText = '◀';
        label.innerText = 'Ocultar Lateral';
    }
    localStorage.setItem('sidebar_recolhida', isCollapsed ? 'sim' : 'nao');
}

document.addEventListener('DOMContentLoaded', () => {
    exibirVendas();
    restaurarRascunho();
    atualizarStatusDrive();

    document.getElementById('drive-autosync').checked = localStorage.getItem('drive_autosync') === 'sim';

    if (localStorage.getItem('sidebar_recolhida') === 'sim') {
        document.body.classList.add('sidebar-collapsed');
        document.getElementById('sidebar-icon').innerText = '▶';
        document.getElementById('sidebar-label').innerText = 'Mostrar Lateral';
    }
});

function buscarComDelay() {
    clearTimeout(timeoutBusca);
    timeoutBusca = setTimeout(() => {
        exibirVendas();
    }, 300);
}

function setFiltroStatus(status) {
    filtroStatus = status;
    document.querySelectorAll('.btn-filter').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`filter-${status}`).classList.add('active');
    exibirVendas();
}

function alternarOrdenacao(campo) {
    if (ordemCampo === campo) {
        ordemDirecao = ordemDirecao === 'asc' ? 'desc' : 'asc';
    } else {
        ordemCampo = campo;
        ordemDirecao = 'desc';
    }
    document.getElementById('sort-data').innerText = ordemCampo === 'data' ? (ordemDirecao === 'asc' ? '↑' : '↓') : '↕';
    document.getElementById('sort-valor').innerText = ordemCampo === 'valor' ? (ordemDirecao === 'asc' ? '↑' : '↓') : '↕';
    exibirVendas();
}

const camposCadastro = ['cliente', 'data', 'item', 'valor', 'parcelamento', 'obs1'];
camposCadastro.forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
        localStorage.setItem('rascunho_venda', JSON.stringify(obterDadosFormularioCadastro()));
    });
});

function restaurarRascunho() {
    const rascunho = JSON.parse(localStorage.getItem('rascunho_venda'));
    if (rascunho) {
        document.getElementById('cliente').value = rascunho.cliente || '';
        document.getElementById('data').value = rascunho.data || '';
        document.getElementById('item').value = rascunho.item || '';
        document.getElementById('valor').value = rascunho.valor || '';
        document.getElementById('parcelamento').value = rascunho.parcelamento || 'À vista';
        document.getElementById('obs1').value = rascunho.obs1 || '';
    }
}

function normalizarValor(str) {
    if (typeof str === 'number') return str;
    const limpo = String(str || '0').replace(/\s/g, '').replace(',', '.');
    const num = parseFloat(limpo);
    return isNaN(num) ? 0 : num;
}

function obterDadosFormularioCadastro() {
    let dataV = document.getElementById('data').value;
    if (!dataV) {
        const agora = new Date();
        dataV = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}`;
    }
    return {
        cliente: document.getElementById('cliente').value.trim(),
        data: dataV,
        item: document.getElementById('item').value.trim(),
        valor: normalizarValor(document.getElementById('valor').value),
        parcelamento: document.getElementById('parcelamento').value,
        obs1: document.getElementById('obs1').value.trim()
    };
}

function gerarId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btnSalvar = document.querySelector('.btn-save');

    try {
        if (!window.api) throw new Error("A API do Electron não está conectada.");

        const dados = obterDadosFormularioCadastro();

        if (!dados.cliente) { alert('O nome do cliente é obrigatório.'); return; }
        if (dados.valor <= 0) { alert('Informe um valor válido maior que zero.'); return; }

        btnSalvar.disabled = true;
        btnSalvar.textContent = "Salvando...";

        const novaVenda = {
            id: gerarId(),
            cliente: dados.cliente,
            data: dados.data,
            item: dados.item,
            valor: dados.valor,
            parcelamento: dados.parcelamento,
            pago: false,
            acerto: false,
            obs1: dados.obs1
        };

        await window.api.saveVenda(novaVenda);
        await sincronizarSilenciosoSeAtivo();
        limparFormulario();
        exibirVendas();

    } catch (erro) {
        alert("Erro crítico ao salvar a venda: " + erro.message);
    } finally {
        btnSalvar.disabled = false;
        btnSalvar.textContent = "Salvar Nova Venda";
    }
});

function limparFormulario() {
    form.reset();
    localStorage.removeItem('rascunho_venda');
}

const fmtMoeda = (val) => val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

async function exibirVendas() {
    try {
        if (!window.api) return;

        const db = await window.api.getVendas();
        dadosAtuaisGlobais = db;

        const busca = document.getElementById('busca-cliente').value.toLowerCase().trim();
        tableBody.innerHTML = '';

        let total = 0, totalPago = 0, totalPendente = 0;
        let clientes = Object.keys(db);

        if (busca) clientes = clientes.filter(c => c.toLowerCase().includes(busca));
        clientes.sort();

        if (clientes.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:20px; color:#7f8c8d;">Nenhum registro encontrado no banco.</td></tr>';
        }

        clientes.forEach(clienteNome => {
            let vendasDoCliente = db[clienteNome];

            if (filtroStatus === 'pagos') vendasDoCliente = vendasDoCliente.filter(v => v.pago);
            if (filtroStatus === 'pendentes') vendasDoCliente = vendasDoCliente.filter(v => !v.pago);

            if (vendasDoCliente.length === 0) return;

            let totalDoCliente = 0;

            vendasDoCliente.sort((a, b) => {
                if (ordemCampo === 'valor') {
                    const vA = parseFloat(a.valor) || 0;
                    const vB = parseFloat(b.valor) || 0;
                    return ordemDirecao === 'asc' ? vA - vB : vB - vA;
                }
                const dA = new Date(a.data);
                const dB = new Date(b.data);
                return ordemDirecao === 'asc' ? dA - dB : dB - dA;
            });

            vendasDoCliente.forEach(v => {
                const val = parseFloat(v.valor) || 0;
                totalDoCliente += val;
                total += val;
                if (v.pago) totalPago += val;
                else totalPendente += val;
            });

            const trHeader = document.createElement('tr');
            trHeader.className = 'client-header';

            const tdHeader = document.createElement('td');
            tdHeader.colSpan = 9;
            tdHeader.innerHTML = `👤 <strong class="nome-cliente-seguro"></strong> <span class="info-direita">Faturamento do Cliente: <b>${fmtMoeda(totalDoCliente)}</b></span>`;
            tdHeader.querySelector('.nome-cliente-seguro').textContent = clienteNome;

            trHeader.appendChild(tdHeader);
            tableBody.appendChild(trHeader);

            vendasDoCliente.forEach(v => {
                const tr = document.createElement('tr');
                tr.className = 'linha-venda';

                const tdHierarquia = document.createElement('td');
                tdHierarquia.textContent = '↳ Venda ID: ' + v.id.slice(0, 4);

                const tdData = document.createElement('td');
                tdData.textContent = (v.data || '').split('-').reverse().join('/');

                const tdItem = document.createElement('td');
                const divItem = document.createElement('div');
                divItem.className = 'obs-texto';
                divItem.textContent = v.item;
                divItem.onclick = () => mostrarModal(v.item, 'Itens Comprados');
                tdItem.appendChild(divItem);

                const tdValor = document.createElement('td');
                tdValor.textContent = fmtMoeda(parseFloat(v.valor) || 0);

                const tdParc = document.createElement('td');
                tdParc.textContent = v.parcelamento;

                const tdStatus = document.createElement('td');
                const spanStatus = document.createElement('span');
                spanStatus.className = `status-badge ${v.pago ? 'bg-pago' : 'bg-pendente'}`;
                spanStatus.textContent = v.pago ? 'Pago' : 'Pendente';
                tdStatus.appendChild(spanStatus);

                const tdObs = document.createElement('td');
                const divObs = document.createElement('div');
                divObs.className = 'obs-texto';
                divObs.textContent = v.obs1 || '-';
                if (v.obs1) divObs.onclick = () => mostrarModal(v.obs1, 'Observação');
                tdObs.appendChild(divObs);

                const tdAcerto = document.createElement('td');
                tdAcerto.style.fontWeight = 'bold';
                tdAcerto.style.color = v.acerto ? 'var(--secondary)' : 'var(--danger)';
                tdAcerto.textContent = v.acerto ? 'Sim' : 'Não';

                const tdAcoes = document.createElement('td');
                const btnEdit = document.createElement('button');
                btnEdit.textContent = 'Editar';
                btnEdit.style.cssText = 'background:var(--warning); padding:5px 10px; font-size:11px; margin-right:5px;';
                btnEdit.onclick = () => abrirModalEdicao(clienteNome, v.id);

                const btnDel = document.createElement('button');
                btnDel.textContent = 'Excluir';
                btnDel.style.cssText = 'background:var(--danger); padding:5px 10px; font-size:11px;';
                btnDel.onclick = () => removerVenda(v.id);

                tdAcoes.append(btnEdit, btnDel);
                tr.append(tdHierarquia, tdData, tdItem, tdValor, tdParc, tdStatus, tdObs, tdAcerto, tdAcoes);
                tableBody.appendChild(tr);
            });
        });

        document.getElementById('kpi-total').innerText = fmtMoeda(total);
        document.getElementById('kpi-pago').innerText = fmtMoeda(totalPago);
        document.getElementById('kpi-pendente').innerText = fmtMoeda(totalPendente);

    } catch (erro) {
        console.error(erro);
    }
}

function abrirModalEdicao(clienteNome, vendaId) {
    const clienteVendas = dadosAtuaisGlobais[clienteNome];
    if (!clienteVendas) return;

    const venda = clienteVendas.find(v => v.id === vendaId);
    if (!venda) return;

    document.getElementById('edit-id').value = vendaId;
    document.getElementById('edit-cliente').value = clienteNome;
    document.getElementById('edit-data').value = venda.data || '';
    document.getElementById('edit-valor').value = venda.valor || '';
    document.getElementById('edit-item').value = venda.item || '';
    document.getElementById('edit-parcelamento').value = venda.parcelamento || 'À vista';
    document.getElementById('edit-pago').checked = Boolean(venda.pago);
    document.getElementById('edit-acerto').checked = Boolean(venda.acerto);
    document.getElementById('edit-obs').value = venda.obs1 || '';

    document.getElementById('modalEditar').style.display = 'flex';
}

function fecharModalEdicao() {
    document.getElementById('modalEditar').style.display = 'none';
}

async function salvarEdicaoModal(e) {
    e.preventDefault();

    try {
        const novoCliente = document.getElementById('edit-cliente').value.trim();
        const novoValor = normalizarValor(document.getElementById('edit-valor').value);

        if (!novoCliente) { alert('O nome do cliente é obrigatório.'); return; }
        if (novoValor <= 0) { alert('Informe um valor válido maior que zero.'); return; }

        const vendaAtualizada = {
            id: document.getElementById('edit-id').value,
            cliente: novoCliente,
            data: document.getElementById('edit-data').value,
            item: document.getElementById('edit-item').value.trim(),
            valor: novoValor,
            parcelamento: document.getElementById('edit-parcelamento').value,
            pago: document.getElementById('edit-pago').checked,
            acerto: document.getElementById('edit-acerto').checked,
            obs1: document.getElementById('edit-obs').value.trim()
        };

        await window.api.updateVenda(vendaAtualizada);
        await sincronizarSilenciosoSeAtivo();
        fecharModalEdicao();
        exibirVendas();
    } catch (erro) {
        alert("Erro ao atualizar venda: " + erro.message);
    }
}

async function removerVenda(vendaId) {
    try {
        const sucesso = await window.api.deleteVenda(vendaId);
        if (sucesso) {
            await sincronizarSilenciosoSeAtivo();
            exibirVendas();
        }
    } catch (erro) {
        console.error(erro);
    }
}

async function exportarDB() {
    try {
        await window.api.exportDB();
    } catch (erro) {
        console.error(erro);
    }
}

async function importarDB() {
    try {
        const sucesso = await window.api.importDB();
        if (sucesso) exibirVendas();
    } catch (erro) {
        console.error(erro);
    }
}

function mostrarModal(txt, tit) {
    document.getElementById('modalTitle').textContent = tit;
    document.getElementById('modalText').textContent = txt;
    document.getElementById('customModal').style.display = 'flex';
}

function fecharModal() {
    document.getElementById('customModal').style.display = 'none';
}

// ==========================================
// CALCULADORA
// ==========================================
const disp = document.getElementById('display');
let historico = JSON.parse(localStorage.getItem('hist_calc') || '[]');

function appendToDisplay(val) {
    if (disp.value === "0" && val !== ".") disp.value = val;
    else disp.value += val;
}

function clearDisplay() { disp.value = "0"; }

function calculate() {
    try {
        let expressao = disp.value;
        if (/[^0-9+\-*/.%\s]/.test(expressao)) throw new Error("Caractere inválido");

        let formatada = expressao.replace(/(\d+(\.\d+)?)\s*([\+\-])\s*(\d+(\.\d+)?)%/g, '($1 $3 ($1 * ($4 / 100)))');
        formatada = formatada.replace(/(\d+(\.\d+)?)%/g, '($1 / 100)');

        const resultado = Function(`'use strict'; return (${formatada})`)();
        const final = Number.isFinite(resultado) ? +(Math.round(resultado + "e+2") + "e-2") : 0;

        disp.value = final;
        historico.unshift(`${expressao} = ${final}`);
        historico = historico.slice(0, 15);
        localStorage.setItem('hist_calc', JSON.stringify(historico));
    } catch {
        disp.value = "Erro";
        setTimeout(clearDisplay, 1200);
    }
}

function toggleHistorico() {
    const main = document.getElementById('calc-main-ui');
    const view = document.getElementById('historico-view');
    const lista = document.getElementById('lista-historico');

    if (view.style.display === 'none' || !view.style.display) {
        main.style.display = 'none';
        view.style.display = 'flex';
        lista.innerHTML = historico.length ? '' : '<li>Vazio</li>';

        historico.forEach(h => {
            const li = document.createElement('li');
            li.textContent = h;
            li.title = "Clique para carregar o valor no visor";
            li.onclick = () => {
                const partes = h.split('=');
                if (partes[1]) {
                    disp.value = partes[1].trim();
                    toggleHistorico();
                }
            };
            lista.appendChild(li);
        });
    } else {
        main.style.display = 'grid';
        view.style.display = 'none';
    }
}

function limparHistorico() {
    historico = [];
    localStorage.removeItem('hist_calc');
    document.getElementById('lista-historico').innerHTML = '<li>Vazio</li>';
}

// ==========================================
// GOOGLE DRIVE BACKUP & RESTORE
// ==========================================
async function atualizarStatusDrive() {
    if (!window.api || !window.api.gdriveStatus) return;
    const { conectado } = await window.api.gdriveStatus();
    driveConectado = conectado;

    const badge = document.getElementById('drive-status-badge');
    const btnAuth = document.getElementById('btn-drive-auth');
    const btnBackup = document.getElementById('btn-drive-backup');
    const btnRestore = document.getElementById('btn-drive-restore');
    const autoSyncLabel = document.getElementById('drive-autosync-label');

    if (conectado) {
        badge.textContent = 'Conectado';
        badge.className = 'drive-badge on';
        btnAuth.textContent = 'Desconectar';
        btnAuth.style.background = '#7f8c8d';
        btnBackup.style.display = 'inline-block';
        btnRestore.style.display = 'inline-block';
        autoSyncLabel.style.display = 'flex';
    } else {
        badge.textContent = 'Desconectado';
        badge.className = 'drive-badge off';
        btnAuth.textContent = 'Conectar Conta';
        btnAuth.style.background = '#2980b9';
        btnBackup.style.display = 'none';
        btnRestore.style.display = 'none';
        autoSyncLabel.style.display = 'none';
    }
}

function toggleAutoSyncDrive() {
    const ativo = document.getElementById('drive-autosync').checked;
    localStorage.setItem('drive_autosync', ativo ? 'sim' : 'nao');
}

async function sincronizarSilenciosoSeAtivo() {
    if (driveConectado && document.getElementById('drive-autosync').checked) {
        try {
            await window.api.gdriveBackup('sync');
        } catch (err) {
            console.warn('Falha na sincronização automática com o Drive:', err.message);
        }
    }
}

async function alternarConexaoDrive() {
    const btn = document.getElementById('btn-drive-auth');
    try {
        if (driveConectado) {
            await window.api.gdriveLogout();
        } else {
            btn.disabled = true;
            btn.textContent = 'Aguardando navegador...';
            await window.api.gdriveLogin();
            alert('Google Drive conectado com sucesso!');
        }
    } catch (erro) {
        alert('Não foi possível conectar ao Google Drive: ' + erro.message);
    } finally {
        btn.disabled = false;
        await atualizarStatusDrive();
    }
}

async function salvarBackupDrive() {
    const btn = document.getElementById('btn-drive-backup');
    try {
        btn.disabled = true;
        btn.textContent = 'Enviando...';
        const res = await window.api.gdriveBackup('snapshot');
        alert(`Backup salvo no Google Drive com sucesso!\nArquivo: ${res.nome}`);
    } catch (erro) {
        alert('Erro ao salvar no Google Drive: ' + erro.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Salvar no Drive';
    }
}

async function abrirModalRestaurarDrive() {
    const modal = document.getElementById('modalDriveRestore');
    const lista = document.getElementById('lista-backups-drive');
    lista.innerHTML = '<li style="padding:15px; text-align:center;">Buscando arquivos no Drive...</li>';
    modal.style.display = 'flex';

    try {
        const arquivos = await window.api.gdriveListBackups();
        if (!arquivos.length) {
            lista.innerHTML = '<li style="padding:15px; text-align:center; color:#7f8c8d;">Nenhum backup encontrado na pasta do Drive.</li>';
            return;
        }

        lista.innerHTML = '';
        arquivos.forEach(arq => {
            const dataFmt = new Date(arq.modifiedTime || arq.createdTime).toLocaleString('pt-BR');
            const li = document.createElement('li');
            li.className = 'backup-item';
            li.innerHTML = `
                <div>
                    <div style="font-weight:bold; font-size:13px;">${arq.name}</div>
                    <div style="font-size:12px; color:#7f8c8d;">Modificado em: ${dataFmt}</div>
                </div>
            `;
            const btn = document.createElement('button');
            btn.textContent = 'Restaurar';
            btn.style.cssText = 'background:var(--secondary); padding:6px 12px; font-size:12px;';
            btn.onclick = () => executarRestauracaoDrive(arq.id);
            li.appendChild(btn);
            lista.appendChild(li);
        });
    } catch (erro) {
        lista.innerHTML = `<li style="padding:15px; color:var(--danger);">Erro ao listar backups: ${erro.message}</li>`;
    }
}

async function executarRestauracaoDrive(fileId) {
    try {
        const ok = await window.api.gdriveRestore(fileId);
        if (ok) {
            fecharModalDrive();
            exibirVendas();
        }
    } catch (erro) {
        alert('Erro ao restaurar arquivo: ' + erro.message);
    }
}

function fecharModalDrive() {
    document.getElementById('modalDriveRestore').style.display = 'none';
}