import { currentUser, tempPedidos, obras, settingsCollection, activeProjectIds, obraOrder, currentAlocacaoEtapaId, currentEtapaGroupContext, activeAlocacaoSortables, conflictMap, currentInfoEtapaId, currentInfoEtapaGroupContext, activeHotelSortables, empresas, selectedEmpresaId, funcionarios, users, userPreferencesCollection, notificacoesCollection } from './store.js';
import { logInteraction, logActivity } from './utils.js';
import { showToast } from './utils.js';
import { getEtapaLogIdentifier } from './utils.js';
import { PROCEDIMENTOS_LIST } from './store.js';
import { getIntegracaoStatus } from './businessLogic.js';
import { obrasCollection, funcionariosCollection, empresasCollection, usersCollection } from './store.js';
import { setDoc, doc, addDoc, updateDoc, getDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const openModal = (modal) => {
    if (!modal) return;
    logInteraction('open_modal', { modalId: modal.id });
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.remove('opacity-0'), 10);
    setTimeout(() => modal.querySelector('.modal-content').classList.remove('scale-95', 'opacity-0'), 50);
};

const closeModal = (modal, showConfirmation = false, message) => {
    if (!modal) return;
    logInteraction('close_modal', { modalId: modal.id });
    modal.querySelector('.modal-content').classList.add('scale-95', 'opacity-0');
    setTimeout(() => {
        modal.classList.add('hidden');
        modal.classList.add('opacity-0');
        if (showConfirmation) {
            showToast(message || 'Ação cancelada.');
        }
    }, 300);
};

const showConfirmModal = (title, message, onConfirm) => {
    const modal = document.getElementById('confirmModal');
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    const confirmOk = document.getElementById('confirmOk');
    const newConfirmOk = confirmOk.cloneNode(true);
    confirmOk.parentNode.replaceChild(newConfirmOk, confirmOk);
    newConfirmOk.addEventListener('click', () => {
        logInteraction('confirm_modal_ok', { title, message });
        onConfirm();
        closeModal(modal);
    });
    document.getElementById('confirmCancel').onclick = () => {
        logInteraction('confirm_modal_cancel', { title, message });
        closeModal(modal, true, 'Ação cancelada.');
    };
    openModal(modal);
};

const handleObraForm = async () => {
    // Prevent non-authorized users from saving
    if (currentUser.perfil === 'Visualizacao') {
        showToast("Usuário de visualização não pode salvar.", 'error');
        return;
    }
    const form = document.getElementById('obraForm');
    // Basic HTML5 validation check
    if(!form.checkValidity()) { form.reportValidity(); return; }

    // v11.2: Seta a flag ANTES de salvar no DB para evitar "race condition" com onSnapshot
    preserveSortOrderOnNextRender = true;

    // Update the temporary pedido/etapa data from the form fields
    updateTempPedidosFromForm();

    // --- Validate Etapa Date Overlaps within the same group ---
    for (const pedido of tempPedidos) {
        const etapasGrouped = (pedido.etapas || []).reduce((acc, et) => {
            if (et.nome) { // Group by name
                if (!acc[et.nome]) acc[et.nome] = [];
                acc[et.nome].push(et);
            }
            return acc;
        }, {});

        for (const groupName in etapasGrouped) {
            const group = etapasGrouped[groupName];
            if (group.length > 1) {
                // Sort by start date to check consecutive overlaps
                const sortedGroup = group.sort((a, b) => new Date(a.data_inicio) - new Date(b.data_inicio));
                for (let i = 0; i < sortedGroup.length - 1; i++) {
                    const e1 = sortedGroup[i];
                    const e2 = sortedGroup[i+1];
                    // Check if end date of e1 is on or after start date of e2
                    if (new Date(e1.data_fim) >= new Date(e2.data_inicio)) {
                        preserveSortOrderOnNextRender = false; // v11.2: Reseta a flag se houver erro de validação
                        showToast(`Conflito de datas na etapa "${groupName}". A data final de uma tarefa não pode ser igual ou maior que a data inicial da seguinte.`, 'error');
                        return; // Stop saving
                    }
                }
            }
        }
    }

    const id = document.getElementById('obraId').value;
    const obraData = {
        nome: document.getElementById('obraNome').value,
        numero: document.getElementById('obraNumero').value,
        cliente: document.getElementById('obraCliente').value,
        pedidos: tempPedidos.map(p => ({ // Ensure new etapas get the visualizacaoRH field
            ...p,
            etapas: (p.etapas || []).map(e => ({
                ...e,
                visualizacaoRH: e.visualizacaoRH ?? false // Default to false if missing
            }))
        })),
    };

    const originalObra = id ? obras.find(o => o.id === id) : {}; // Get original data for logging changes

    try {
        if (id) { // --- UPDATE EXISTING OBRA ---
            obraData.lastUpdate = new Date();
            const docRef = doc(obrasCollection, id);
            await updateDoc(docRef, obraData);
            logInteraction('update_obra', { id: docRef.id });

            // --- Log specific changes ---
            if(originalObra.nome !== obraData.nome) {
                await logActivity(id, `renomeou o projeto de "${originalObra.nome}" para "${obraData.nome}".`);
            }
            // Compare pedidos and etapas for detailed logs
            const originalPedidosMap = new Map((originalObra.pedidos || []).map(p => [p.id, p]));
            for (const newPedido of obraData.pedidos) {
                const originalPedido = originalPedidosMap.get(newPedido.id);
                if (!originalPedido) { // Pedido was added (should ideally not happen via update form like this)
                     await logActivity(id, `adicionou o pedido "${newPedido.numero}".`);
                     continue;
                }
                // Compare pedido number
                 if (originalPedido.numero !== newPedido.numero) {
                    await logActivity(id, `renomeou o pedido "${originalPedido.numero}" para "${newPedido.numero}".`);
                 }

                // Compare etapas within the pedido
                const originalEtapasMap = new Map((originalPedido.etapas || []).map(e => [e.id, e]));
                for (const newEtapa of (newPedido.etapas || [])) {
                    const originalEtapa = originalEtapasMap.get(newEtapa.id);
                    const etapaIdentifier = getEtapaLogIdentifier(newPedido, newEtapa.id);

                    if (!originalEtapa) { // Etapa was added
                        await logActivity(id, `criou a etapa ${etapaIdentifier} no pedido "${newPedido.numero}".`);
                    } else { // Etapa existed, check for changes
                        if (originalEtapa.nome !== newEtapa.nome) {
                            await logActivity(id, `renomeou a etapa "${originalEtapa.nome}" para ${etapaIdentifier} no pedido "${newPedido.numero}".`);
                        }
                        if (originalEtapa.data_inicio !== newEtapa.data_inicio) {
                            await logActivity(id, `alterou a data de início da etapa ${etapaIdentifier} no pedido "${newPedido.numero}" de ${originalEtapa.data_inicio || 'N/A'} para ${newEtapa.data_inicio || 'N/A'}.`);
                        }
                        if (originalEtapa.data_fim !== newEtapa.data_fim) {
                            await logActivity(id, `alterou a data final da etapa ${etapaIdentifier} no pedido "${newPedido.numero}" de ${originalEtapa.data_fim || 'N/A'} para ${newEtapa.data_fim || 'N/A'}.`);
                        }
                    }
                }
                 // Check for removed etapas
                 for (const originalEtapa of (originalPedido.etapas || [])) {
                    if (!(newPedido.etapas || []).find(e => e.id === originalEtapa.id)) {
                        const etapaIdentifier = getEtapaLogIdentifier(originalPedido, originalEtapa.id);
                        await logActivity(id, `removeu a etapa ${etapaIdentifier} do pedido "${originalPedido.numero}".`);
                    }
                }
            }
             // Check for removed pedidos
            for(const originalPedido of (originalObra.pedidos || [])) {
                if (!obraData.pedidos.find(p => p.id === originalPedido.id)) {
                    await logActivity(id, `removeu o pedido "${originalPedido.numero}".`);
                }
            }


        } else { // --- CREATE NEW OBRA ---
            obraData.createdAt = new Date();
            obraData.finalizada = false; // Default values for new obra
            obraData.pendencias = [];
            obraData.observacoes = "";
            // Initial activity log entry
            obraData.activityLog = [{
                user: currentUser.nome,
                message: `criou o projeto "${obraData.nome}".`,
                timestamp: new Date()
            }];
            const docRef = await addDoc(obrasCollection, obraData);
            logInteraction('create_obra', { id: docRef.id });
            // Automatically add new project to active list and manual sort order
            if(!activeProjectIds.includes(docRef.id)) {
                activeProjectIds.push(docRef.id);
                await setDoc(doc(settingsCollection, 'activeProjects'), { ids: activeProjectIds });
            }
            if (!obraOrder.includes(docRef.id)) {
                obraOrder.unshift(docRef.id); // Add to the beginning
                await setDoc(doc(settingsCollection, 'obraOrder'), { order: obraOrder });
            }
            // **BUG FIX:** Force re-render after adding new project
            lastKnownScrollLeft = null; // Reset scroll as it's a new project
            renderGanttChart(); // <<--- ADDED THIS LINE
        }

        // Preserve scroll if updating, otherwise it might have been reset
        if (id) {
           lastKnownScrollLeft = document.querySelector('#ganttChartContainer .gantt-timeline')?.scrollLeft ?? lastKnownScrollLeft;
        }
        closeModal(document.getElementById('obraModal'));
        showToast(`Projeto "${obraData.nome}" salvo com sucesso!`);
    } catch (error) {
        console.error("Erro ao salvar projeto: ", error);
        logInteraction('error_save_obra', { error });
        preserveSortOrderOnNextRender = false; // v11.2: Reseta a flag em caso de erro no salvamento
    }
};

const handleEmpresaForm = async (e) => {
    e.preventDefault();
    if (currentUser.perfil === 'Visualizacao') { showToast("Não permitido.", 'error'); return; }
    const form = e.target;
    if(!form.checkValidity()) { form.reportValidity(); return; }
    const id = document.getElementById('empresaId').value;
    const empresaData = {
        nome: document.getElementById('empresaNome').value,
        tipo: document.getElementById('empresaTipo').value,
    };
    try {
        // --- MODIFICAÇÃO v10.5 (Ponto 1) ---
        // const docRef = id ? doc(empresasCollection, id) : collection(empresasCollection); // Get ref for addDoc or setDoc
        if(id) {
             await setDoc(doc(empresasCollection, id), empresaData, { merge: true }); // Update existing
             logInteraction('update_empresa', { id: id, data: empresaData });
        } else {
            const docRef = await addDoc(empresasCollection, empresaData); // Create new
            logInteraction('create_empresa', { id: docRef.id, data: empresaData });
        }
        // --- FIM DA MODIFICAÇÃO ---

        closeModal(document.getElementById('empresaModal'));
        showToast(`Empresa "${empresaData.nome}" salva com sucesso!`);
    } catch (error) { console.error("Erro ao salvar empresa: ", error); logInteraction('error_save_empresa', { error }); }
};

const handleFuncionarioForm = async (e) => {
    e.preventDefault();
    if (currentUser.perfil === 'Visualizacao') { showToast("Não permitido.", 'error'); return; }
    const form = e.target;
    if(!form.checkValidity()) { form.reportValidity(); return; }
    const id = document.getElementById('funcionarioId').value;
    const funcionarioData = {
        nome: document.getElementById('funcionarioNome').value,
        cargo: document.getElementById('funcionarioCargo').value,
        empresa_id: document.getElementById('funcionarioEmpresaId').value,
        integracaoBRF: document.getElementById('funcionarioIntegracaoBRF').value || null, // Save null if empty
        integracaoJBS: document.getElementById('funcionarioIntegracaoJBS').value || null, // Save null if empty
    };
    try {
         // --- MODIFICAÇÃO v10.5 (Ponto 1) ---
        if(id) {
             await setDoc(doc(funcionariosCollection, id), funcionarioData, { merge: true });
             logInteraction('update_funcionario', { id: id, data: funcionarioData });
        } else {
             const docRef = await addDoc(funcionariosCollection, funcionarioData);
             logInteraction('create_funcionario', { id: docRef.id, data: funcionarioData });
        }
        // --- FIM DA MODIFICAÇÃO ---

        closeModal(document.getElementById('funcionarioModal'));
        showToast(`Funcionário "${funcionarioData.nome}" salvo com sucesso!`);
    } catch (error) { console.error("Erro ao salvar funcionário: ", error); logInteraction('error_save_funcionario', { error });}
};

const openObraModal = (obra = {}) => {
    document.getElementById('obraForm').reset();
    document.getElementById('obraId').value = obra.id || '';
    document.getElementById('obraModalTitle').textContent = obra.id ? `Editar Projeto: ${obra.nome}` : 'Novo Projeto';
    document.getElementById('obraNome').value = obra.nome || '';
    document.getElementById('obraNumero').value = obra.numero || '';
    document.getElementById('obraCliente').value = obra.cliente || '';
    // Deep copy pedidos to avoid modifying the original data directly
    tempPedidos = JSON.parse(JSON.stringify(obra.pedidos || []));
    // Show/hide buttons based on whether it's a new or existing obra
    document.getElementById('deleteObraBtn').style.display = obra.id ? 'block' : 'none';
    document.getElementById('generateObraReportBtn').style.display = obra.id ? 'block' : 'none';
    document.getElementById('activityLogBtn').style.display = obra.id ? 'block' : 'none';
    document.getElementById('pendenciasFromObraModalBtn').style.display = obra.id ? 'block' : 'none';
    renderPedidosForm(); // Render the form sections for pedidos and etapas
    openModal(document.getElementById('obraModal')); // Open the modal
};

const renderPedidosForm = () => {
    const container = document.getElementById('pedidosContainer');
    container.innerHTML = '';
    // Show placeholder if there are no pedidos
    if (tempPedidos.length === 0) {
         container.innerHTML = '<p class="text-sm text-gray-500 text-center py-4">Nenhum pedido. Clique em "+ Adicionar Pedido" para começar.</p>';
    }
    tempPedidos.forEach(pedido => {
        const pedidoEl = document.createElement('div');
        pedidoEl.className = 'p-3 bg-gray-700/50 rounded-lg pedido-form-item';
        pedidoEl.dataset.id = pedido.id;
        let etapasHTML = '<div class="space-y-2 mt-3">';
        // Render each etapa within the pedido
        (pedido.etapas || []).forEach(etapa => {
             etapasHTML += `<div class="etapa-item grid grid-cols-12 gap-2 items-center" data-id="${etapa.id}">
                    <input type="text" value="${etapa.nome}" placeholder="Nome da Etapa" class="col-span-5 p-1 text-sm bg-gray-600 border-gray-500 rounded etapa-nome" required>
                    <input type="date" value="${etapa.data_inicio || ''}" class="col-span-3 p-1 text-sm bg-gray-600 border-gray-500 rounded etapa-inicio" required>
                    <input type="date" value="${etapa.data_fim || ''}" class="col-span-2 p-1 text-sm bg-gray-600 border-gray-500 rounded etapa-fim" required>
                    <button type="button" class="copy-etapa-btn action-btn text-blue-400 hover:text-blue-300" title="Copiar Etapa">
                        <svg class="h-5 w-5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                    </button>
                    <button type="button" class="remove-etapa-btn action-btn text-red-500 hover:text-red-400" title="Remover Etapa">
                        <svg class="h-5 w-5 pointer-events-none" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5 10a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1z" clip-rule="evenodd" /></svg>
                    </button>
                </div>`;
        });
        etapasHTML += '</div>';
        // Assemble pedido element HTML
        pedidoEl.innerHTML = `<div class="flex justify-between items-center">
                <div class="flex items-center gap-2 flex-grow">
                    <label class="font-semibold text-sm">Pedido Nº:</label>
                    <input type="text" value="${pedido.numero}" placeholder="Número" class="pedido-numero p-2 bg-gray-600 border-gray-500 rounded-lg w-40 text-sm" required>
                </div>
                <div>
                     <button type="button" class="add-etapa-btn bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold py-1 px-2 rounded">+ Etapa</button>
                     <button type="button" class="remove-pedido-btn action-btn text-red-500 hover:text-red-400 p-1"><svg class="h-5 w-5 pointer-events-none" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V8z" clip-rule="evenodd" /></svg></button>
                </div>
            </div>
            ${etapasHTML}`;
        container.appendChild(pedidoEl);
    });
    // Add validation listeners for date inputs to ensure end date >= start date
    container.querySelectorAll('.etapa-item').forEach(etapaEl => {
        const inicioInput = etapaEl.querySelector('.etapa-inicio');
        const fimInput = etapaEl.querySelector('.etapa-fim');

        inicioInput.addEventListener('change', () => {
            if (inicioInput.value) {
                fimInput.min = inicioInput.value; // Set min attribute of end date
                // Auto-adjust end date if it becomes invalid
                if (!fimInput.value || new Date(fimInput.value) < new Date(inicioInput.value)) {
                    fimInput.value = inicioInput.value;
                }
            } else {
                fimInput.min = ''; // Remove min attribute if start date is cleared
            }
        });

        fimInput.addEventListener('change', () => {
            if (fimInput.value && inicioInput.value) {
               // Auto-adjust start date if it becomes invalid (less common case)
               if (new Date(inicioInput.value) > new Date(fimInput.value)) {
                   inicioInput.value = fimInput.value;
                   fimInput.min = inicioInput.value; // Re-set min attribute
               }
            }
        });

        // Set initial min attribute for end date if start date is pre-filled
        if (inicioInput.value) fimInput.min = inicioInput.value;
    });
};

const updateTempPedidosFromForm = () => {
     // Read data from the form elements and update the `tempPedidos` array
     tempPedidos = Array.from(document.querySelectorAll('.pedido-form-item')).map(pedidoEl => {
        const pedidoId = pedidoEl.dataset.id;
        const originalPedido = tempPedidos.find(p => p.id === pedidoId) || {}; // Find original to preserve unchanged data
         return {
            id: pedidoId,
            numero: pedidoEl.querySelector('.pedido-numero').value,
            etapas: Array.from(pedidoEl.querySelectorAll('.etapa-item')).map(etapaEl => {
                const etapaId = etapaEl.dataset.id;
                const originalEtapa = (originalPedido.etapas || []).find(e => e.id === etapaId) || {};
                // Merge original data with form data
                return {
                    ...originalEtapa, // Keep existing fields like alocados, procedures, etc.
                    id: etapaId,
                    nome: etapaEl.querySelector('.etapa-nome').value,
                    data_inicio: etapaEl.querySelector('.etapa-inicio').value,
                    data_fim: etapaEl.querySelector('.etapa-fim').value,
                    // visualizacaoRH defaults to false if not present (handled in handleObraForm)
                };
            })
        };
    });
};

const createColaboradorCard = (func, conflictInfo = null, options = {}) => {
    // v10.10 - Esta função renderiza o card na MODAL DE ALOCAÇÃO
    const { isDimmed = false, integracaoStatus = null, occupiedDetailsMap = null } = options;
    const card = document.createElement('div');
    card.className = 'colaborador-card'; // Estilo base do card
    card.dataset.id = func.id;

    // Determina o status da tag
    const status = integracaoStatus || getIntegracaoStatus(func);
    const brfStatus = status.brf.status;
    const jbsStatus = status.jbs.status;

    // Define a cor da tag (verde, amarela, vermelha)
    const getTagClass = (s) => {
        if (s === 'em_dia') return 'tag-verde';
        if (s === 'vencendo') return 'tag-amarela';
        if (s === 'vencida') return 'tag-vermelha';
        return ''; // Sem tag
    };

    const brfTagClass = getTagClass(brfStatus);
    const jbsTagClass = getTagClass(jbsStatus);

    // Aplica fundo de conflito se houver
    if (conflictInfo) {
        card.classList.add('conflict');
        card.title = conflictInfo;
    } else if (isDimmed) {
        card.style.opacity = '0.5';
        card.style.cursor = 'not-allowed';
        card.title = (occupiedDetailsMap && occupiedDetailsMap.get(func.id)) || 'Ocupado em outra tarefa neste período.';
    }

    // v10.10: Layout Corrigido (Linha Única com flex justify-between)
    // (Nome - Cargo) ............................ [BRF] [JBS]
    card.innerHTML = `
        <div class="colaborador-card-content">
            <div class="colaborador-info" title="${func.nome}${func.cargo ? ` - ${func.cargo}` : ''}">
                ${func.nome}
                ${func.cargo ? `<span class="cargo"> - ${func.cargo}</span>` : ''}
            </div>
            <div class="integracao-tags">
                ${brfTagClass ? `<span class="tag-integracao ${brfTagClass}">BRF</span>` : ''}
                ${jbsTagClass ? `<span class="tag-integracao ${jbsTagClass}">JBS</span>` : ''}
            </div>
        </div>
    `;

    return card;
};

const createMiniColaboradorCard = (func) => {
     const card = document.createElement('div');
     card.className = 'colaborador-card !p-1 !text-xs'; // Smaller card style
     card.dataset.id = func.id;
     card.innerHTML = `<strong class="nome">${func.nome}</strong>`;
     return card;
}
