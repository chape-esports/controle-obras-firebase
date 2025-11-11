// --- FIREBASE IMPORTS ---
import { signInAnonymously, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, onSnapshot, doc, setDoc, addDoc, deleteDoc, updateDoc, getDoc, serverTimestamp, query, arrayUnion, where, orderBy, limit, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, auth } from './firebaseConfig.js';

import {
    obrasCollection, funcionariosCollection, empresasCollection, settingsCollection, usersCollection, userPreferencesCollection, notificacoesCollection,
    appId,
    currentUser,
    obras, funcionarios, empresas, users, obraOrder, activeProjectIds, notificacoes,
    tempPedidos,
    ganttExpandedState,
    selectedEmpresaId,
    currentAlocacaoEtapaId,
    currentInfoEtapaId,
    currentEtapaGroupContext,
    currentInfoEtapaGroupContext,
    activeAlocacaoSortables, activeHotelSortables, activeProjectsSortables,
    ganttSidebarSortable,
    currentTab,
    colaboradorEtapasMap,
    conflictMap,
    obraLabelType,
    zoomLevel,
    zoomLevels,
    lastKnownScrollLeft,
    ganttDragInfo,
    copyModeState,
    unsubscribeNotifications,
    preserveSortOrderOnNextRender,
    currentObraRenderOrder,
    PROCEDIMENTOS_LIST,
    isLoggingEnabled,
    systemLogs,
    projectColors,
    setObrasCollection, setFuncionariosCollection, setEmpresasCollection, setSettingsCollection, setUsersCollection, setUserPreferencesCollection, setNotificacoesCollection,
    setCurrentUser,
    setObras, setFuncionarios, setEmpresas, setUsers, setObraOrder, setActiveProjectIds, setNotificacoes,
    setTempPedidos,
    setGanttExpandedState,
    setSelectedEmpresaId,
    setCurrentAlocacaoEtapaId,
    setCurrentInfoEtapaId,
    setCurrentEtapaGroupContext,
    setCurrentInfoEtapaGroupContext,
    setActiveAlocacaoSortables, setActiveHotelSortables, setActiveProjectsSortables,
    setGanttSidebarSortable,
    setCurrentTab,
    setObraLabelType,
    setZoomLevel,
    setLastKnownScrollLeft,
    setGanttDragInfo,
    setCopyModeState,
    setUnsubscribeNotifications,
    setPreserveSortOrderOnNextRender,
    setCurrentObraRenderOrder,
    setIsLoggingEnabled,
    setSystemLogs
} from './store.js';

// --- SISTEMA DE LOG E NOTIFICAÇÃO ---
const getEtapaLogIdentifier = (pedido, etapaId) => {
    if (!pedido || !etapaId) return 'etapa desconhecida';
    const etapa = (pedido.etapas || []).find(e => e.id === etapaId);
    if (!etapa) return 'etapa desconhecida';

    const group = (pedido.etapas || [])
        .filter(e => e.nome === etapa.nome)
        .sort((a, b) => new Date(a.data_inicio) - new Date(b.data_inicio));

    if (group.length > 1) {
        const index = group.findIndex(e => e.id === etapaId);
        return `"${etapa.nome}" (${index + 1} de ${group.length})`;
    }

    return `"${etapa.nome}"`;
};

const createNotification = async (obraId, obraNome, message) => {
    if (!currentUser || !obraId || !message) return;
    try {
        await addDoc(notificacoesCollection, {
            obraId,
            obraNome,
            message,
            user: currentUser.nome,
            timestamp: new Date(),
            readBy: []
        });
    } catch (error) {
        console.error("Erro ao criar notificação:", error);
    }
};

const logInteraction = (action, payload) => {
    if (!isLoggingEnabled) return;
    const logEntry = {
        timestamp: new Date().toISOString(),
        user: currentUser?.nome || 'Sistema',
        action: action,
        payload: payload,
        tab: currentTab,
    };
    systemLogs.push(logEntry);
    console.log(`[LOG] User: ${logEntry.user}, Action: ${action}`, payload);
};
const logActivity = async (obraId, message, createNotificationFlag = true) => {
    if (!obraId || !message || !currentUser) {
        console.error("LOG: Parâmetros faltando para registrar atividade.", { obraId, message, user: currentUser });
        return;
    }
    const obra = obras.find(o => o.id === obraId);
    const obraNome = obra ? obra.nome : 'Projeto desconhecido';

    const logEntry = {
        user: currentUser.nome,
        message: message,
        timestamp: new Date()
    };
    try {
        const obraRef = doc(obrasCollection, obraId);
        await updateDoc(obraRef, {
            activityLog: arrayUnion(logEntry)
        });
        if (createNotificationFlag) {
            await createNotification(obraId, obraNome, `${currentUser.nome} ${message}`);
        }
    } catch (error) {
        console.error("LOG: FALHA ao registrar atividade:", error);
    }
};

const downloadLogs = () => {
    const blob = new Blob([JSON.stringify(systemLogs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `log_controle_obras_${new Date().toISOString()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    logInteraction('download_logs', { count: systemLogs.length });
};
const toggleLogging = () => {
    isLoggingEnabled = !isLoggingEnabled;
    const toggleBtn = document.getElementById('toggleLogBtn');
    const downloadBtn = document.getElementById('downloadLogBtn');
    if (isLoggingEnabled) {
        toggleBtn.textContent = 'Desativar Log de Depuração';
        toggleBtn.classList.add('text-green-500');
        downloadBtn.classList.remove('hidden');
        systemLogs = [];
        logInteraction('logging_started', {});
        showToast('Log de depuração ativado.');
    } else {
        toggleBtn.textContent = 'Ativar Log de Depuração';
        toggleBtn.classList.remove('text-green-500');
        downloadBtn.classList.add('hidden');
        logInteraction('logging_stopped', {});
        showToast('Log de depuração desativado.');
    }
};

import { showToast, getColorForId, addDays, diffInDays, getWeekNumber } from './utils.js';
import { openModal, closeModal, showConfirmModal, handleObraForm, handleEmpresaForm, handleFuncionarioForm, openObraModal, renderPedidosForm, updateTempPedidosFromForm, createColaboradorCard, createMiniColaboradorCard } from './modalHandlers.js';



// --- LÓGICA DE CÓPIA DE ALOCADOS ---
const enterCopyMode = (etapaId) => {
    const [,,etapa] = findEtapaParents(etapaId);
    const alocados = etapa?.colaboradores_alocados || [];

    if (alocados.length === 0) {
        showToast("Não há colaboradores alocados para copiar.", "error");
        return; // Nothing to copy
    }

    // Set global state for copy mode
    copyModeState = {
        active: true,
        sourceEtapaId: etapaId,
        colaboradoresToCopy: alocados
    };

    closeModal(document.getElementById('alocacaoModal')); // Close the alocacao modal

    // Switch to Gantt view if not already there
    if (currentTab !== 'Gantt') {
        switchTab('Gantt');
    } else {
        renderGanttChart(); // Re-render Gantt to apply copy mode styles
    }

    // Show the copy mode indicator panel
    document.getElementById('copyModePanel').classList.remove('hidden');
    document.body.classList.add('copy-mode-active'); // Add class for potential global styling/cursor changes
    logInteraction('enter_copy_mode', { sourceEtapaId: etapaId, count: alocados.length });
};

const exitCopyMode = () => {
    // Reset global state
    copyModeState = { active: false, sourceEtapaId: null, colaboradoresToCopy: [] };
    // Hide indicator panel
    document.getElementById('copyModePanel').classList.add('hidden');
    document.body.classList.remove('copy-mode-active');
    renderGanttChart(); // Re-render Gantt to remove copy mode styles
    logInteraction('exit_copy_mode', {});
};

// --- LÓGICA DE INFO ETAPA (MODAL) ---
const openInfoEtapaModal = (etapaId) => {
    currentInfoEtapaId = etapaId; // Store the ID of the currently viewed etapa
    const modal = document.getElementById('infoEtapaModal');
    document.getElementById('infoEtapaId').value = etapaId; // Set hidden input value
    const [parentObra, parentPedido, etapa] = findEtapaParents(etapaId);
    if (!etapa) { console.error("Etapa não encontrada"); return; }

    // --- Setup Navigator ---
    const navigatorContainer = document.getElementById('infoEtapaNavigator');
    // Find the group of etapas with the same name for navigation
    const group = (parentPedido.etapas || [])
        .filter(e => e.nome === etapa.nome)
        .sort((a, b) => new Date(a.data_inicio) - new Date(b.data_inicio));
    const index = group.findIndex(e => e.id === etapaId);
    currentInfoEtapaGroupContext = { group, index }; // Store context

    // Show/hide navigator based on group size
    if (group.length > 1) {
        navigatorContainer.classList.remove('hidden');
        document.getElementById('infoEtapaNavigatorText').textContent = `Etapa (${index + 1} de ${group.length})`;
        document.getElementById('infoEtapaNavPrev').disabled = index === 0; // Disable prev if first
        document.getElementById('infoEtapaNavNext').disabled = index === group.length - 1; // Disable next if last
    } else {
        navigatorContainer.classList.add('hidden');
    }

    // --- Populate Basic Info ---
    document.getElementById('infoEtapaModalTitle').textContent = `Informações da Etapa: ${etapa.nome}`;
    document.getElementById('infoEtapaModalSubtitle').textContent = `Projeto: ${parentObra.nome} | Pedido: ${parentPedido.numero}`;
    document.getElementById('infoEtapaNome').textContent = etapa.nome || 'N/A';
    document.getElementById('infoEtapaInicio').textContent = etapa.data_inicio ? new Date(etapa.data_inicio + 'T00:00:00').toLocaleDateString('pt-BR') : 'N/A';
    document.getElementById('infoEtapaFim').textContent = etapa.data_fim ? new Date(etapa.data_fim + 'T00:00:00').toLocaleDateString('pt-BR') : 'N/A';

    // --- Populate Form Fields ---
    document.getElementById('infoClienteNome').value = parentObra.cliente || ''; // Readonly field
    document.getElementById('infoClienteTelefone').value = etapa.clienteTelefone || '';
    document.getElementById('infoClienteEmail').value = etapa.clienteEmail || '';
    document.getElementById('infoEncarregado').value = etapa.encarregado || '';
    document.getElementById('infoDescricao').value = etapa.descricao || '';

    // --- Render Dynamic Sections ---
    renderComentarios(etapa); // Render comments section
    renderLogisticaList(etapa.logistica || []); // Render logistics section
    renderProcedimentos(etapa.procedimentos || {}); // Render RH procedures section
    document.getElementById('infoResponsavelNome').value = etapa.procedimentos?.responsavel || ''; // Populate responsible person
    renderHotelLists(etapa.colaboradores_alocados || [], etapa.hotelaria || {}); // Render hotel allocation section

    openModal(modal); // Open the modal
};

const refreshInfoEtapaModalContent = () => {
    // Refreshes the content of the Info Etapa modal if it's open
    // Useful when underlying data changes due to Firestore updates
    if (!currentInfoEtapaId) return; // Exit if no etapa is currently being viewed

    const [parentObra, parentPedido, etapa] = findEtapaParents(currentInfoEtapaId);

    // If the etapa (or its parents) no longer exists, close the modal
    if (!etapa || !parentObra || !parentPedido) {
        const modal = document.getElementById('infoEtapaModal');
        if (modal && !modal.classList.contains('hidden')) { // Check if modal is actually open
            closeModal(modal);
            showToast("A etapa que você estava visualizando foi removida ou alterada.", "error");
            currentInfoEtapaId = null; // Reset the current ID
        }
        return;
    }

    // --- Re-populate only the fields that might change frequently ---
    // Basic info (Nome, Datas) usually changes via Obra modal, less likely here.
    // Client Name is read-only.
    document.getElementById('infoClienteTelefone').value = etapa.clienteTelefone || '';
    document.getElementById('infoClienteEmail').value = etapa.clienteEmail || '';
    document.getElementById('infoEncarregado').value = etapa.encarregado || '';
    document.getElementById('infoDescricao').value = etapa.descricao || '';

    // --- Re-render dynamic sections ---
    renderComentarios(etapa);
    renderLogisticaList(etapa.logistica || []);
    renderProcedimentos(etapa.procedimentos || {});
    document.getElementById('infoResponsavelNome').value = etapa.procedimentos?.responsavel || '';
    // Re-render hotel lists, passing the potentially updated list of allocated employees
    renderHotelLists(etapa.colaboradores_alocados || [], etapa.hotelaria || {});
};


// --- LÓGICA DE COMENTÁRIOS ---
const renderComentarios = (etapa) => {
    const container = document.getElementById('comentariosContainer');
    container.innerHTML = '';
    const comentarios = etapa.comentarios || [];

    // Show placeholder if no comments
    if (comentarios.length === 0) {
        container.innerHTML = '<p class="text-sm text-gray-500">Nenhum comentário ainda.</p>';
        return;
    }

    // Preserve original index for editing/deleting, then sort by timestamp
    const sortedComentarios = [...comentarios]
        .map((c, index) => ({...c, originalIndex: index })) // Add original index
        .sort((a, b) => {
            // Handle both Firestore Timestamps and JS Date objects
            const dateA = a.timestamp?.toDate ? a.timestamp.toDate() : (a.timestamp ? new Date(a.timestamp) : 0);
            const dateB = b.timestamp?.toDate ? b.timestamp.toDate() : (b.timestamp ? new Date(b.timestamp) : 0);
            return dateA - dateB; // Sort ascending (oldest first)
        });

    // Render each comment using the template
    sortedComentarios.forEach(c => {
        const commentTemplate = document.getElementById('comment-template').content.cloneNode(true);
        const commentItem = commentTemplate.querySelector('.comment-item');

        commentItem.dataset.index = c.originalIndex; // Store original index for actions
        commentItem.querySelector('.comment-user').textContent = c.user;

        // Format and display the timestamp
        const dateCell = commentItem.querySelector('.comment-date');
        let date = null;
        if (c.timestamp?.toDate) { date = c.timestamp.toDate(); } // Firestore Timestamp
        else if (c.timestamp instanceof Date || (typeof c.timestamp === 'string' && !isNaN(new Date(c.timestamp)))) { date = new Date(c.timestamp); } // JS Date or valid date string
        else if (typeof c.timestamp === 'object' && c.timestamp !== null && typeof c.timestamp.seconds === 'number') { date = new Date(c.timestamp.seconds * 1000); } // Object from JSON.parse

        if (date && !isNaN(date)) {
            dateCell.textContent = date.toLocaleString('pt-BR');
            // Add '(editado)' indicator if applicable
            if (c.editadoEm) {
                const editedSpan = document.createElement('span');
                editedSpan.className = 'text-xs text-gray-500 ml-2';
                editedSpan.textContent = '(editado)';
                dateCell.appendChild(editedSpan);
            }
        } else {
            dateCell.textContent = 'Data indisponível'; // Fallback
        }

        commentItem.querySelector('.comment-text').textContent = c.texto; // Display comment text

        // Add edit/delete actions if the current user is admin or the comment author
        const actionsContainer = commentItem.querySelector('.comment-actions');
        if (currentUser && (currentUser.perfil === 'admin' || currentUser.nome === c.user)) {
            const actionsTemplate = document.getElementById('comment-actions-template').content.cloneNode(true);
            actionsContainer.appendChild(actionsTemplate);
        }

        container.appendChild(commentItem);
    });
    // Scroll to the bottom to show the latest comments
    container.scrollTop = container.scrollHeight;
};

const handleComentarioForm = async (e) => {
    e.preventDefault();
    if (currentUser.perfil === 'Visualizacao') { showToast("Não permitido.", 'error'); return; }

    const input = document.getElementById('novoComentarioInput');
    const texto = input.value.trim();
    if (!texto) return; // Ignore empty comments

    const [targetObra, targetPedido, ] = findEtapaParents(currentInfoEtapaId); // Find parent obra and pedido
    if (!targetObra || !targetPedido) {
        showToast("Falha ao salvar comentário: Obra ou Pedido não encontrado.", 'error');
        return;
    }

    const novoComentario = {
        user: currentUser.nome,
        texto: texto,
        timestamp: new Date() // Use client-side date for immediate display consistency
    };

    try {
        const obraRef = doc(obrasCollection, targetObra.id);

        // --- Fetch latest data before updating ---
        // This is crucial to avoid overwriting concurrent changes made by others
        const obraSnap = await getDoc(obraRef);
        if (!obraSnap.exists()) throw new Error("Obra não encontrada para adicionar comentário.");

        const obraToUpdate = obraSnap.data();
        // Find the correct pedido and etapa within the fetched data
        const pedidoToUpdate = obraToUpdate.pedidos.find(p => p.id === targetPedido.id);
        if (!pedidoToUpdate) throw new Error("Pedido não encontrado dentro da Obra.");
        const etapaToUpdate = pedidoToUpdate.etapas.find(e => e.id === currentInfoEtapaId);
        if (!etapaToUpdate) throw new Error("Etapa não encontrada dentro do Pedido.");

        // Add the new comment to the array (initialize if it doesn't exist)
        if (!etapaToUpdate.comentarios) etapaToUpdate.comentarios = [];
        etapaToUpdate.comentarios.push(novoComentario);

        // --- Update the entire 'pedidos' array in Firestore ---
        await updateDoc(obraRef, { pedidos: obraToUpdate.pedidos });

        input.value = ''; // Clear the input field

        logInteraction('add_comment', { etapaId: currentInfoEtapaId, texto });
        const etapaIdentifier = getEtapaLogIdentifier(pedidoToUpdate, currentInfoEtapaId);
        await logActivity(targetObra.id, `adicionou um comentário na etapa ${etapaIdentifier}.`);
        // The UI will be updated automatically by the onSnapshot listener for the 'obras' collection

    } catch (error) {
        showToast("Falha ao salvar comentário.", 'error');
        console.error("Erro ao salvar comentário:", error);
    }
};

const handleDeleteComentario = async (commentIndex) => {
     // Find parent obra using the currentInfoEtapaId
    const [targetObra, targetPedido, ] = findEtapaParents(currentInfoEtapaId);
    if (!targetObra || !targetPedido) {
        showToast("Erro: Obra ou Pedido não encontrado.", "error");
        return;
    }

    // Show confirmation dialog before deleting
    showConfirmModal("Excluir Comentário", "Tem certeza que deseja excluir este comentário? Esta ação é irreversível.", async () => {
        try {
            const obraRef = doc(obrasCollection, targetObra.id);
             // --- Fetch latest data before updating ---
            const obraSnap = await getDoc(obraRef);
            if (!obraSnap.exists()) throw new Error("Obra não encontrada para excluir comentário.");

            const obraToUpdate = obraSnap.data();
            const pedidoToUpdate = obraToUpdate.pedidos.find(p => p.id === targetPedido.id);
            if (!pedidoToUpdate) throw new Error("Pedido não encontrado.");
            const etapaToUpdate = pedidoToUpdate.etapas.find(e => e.id === currentInfoEtapaId);
            if (!etapaToUpdate || !etapaToUpdate.comentarios) throw new Error("Etapa ou comentários não encontrados.");

            // --- Remove the comment using its original index ---
            const comentarioRemovido = etapaToUpdate.comentarios[commentIndex]; // For logging if needed
            if (!comentarioRemovido) throw new Error("Comentário no índice especificado não encontrado.");

             // Check permissions again just before deletion
            if (currentUser.perfil !== 'admin' && currentUser.nome !== comentarioRemovido.user) {
                showToast("Você não tem permissão para excluir este comentário.", "error");
                return;
            }

            etapaToUpdate.comentarios.splice(commentIndex, 1); // Remove from array

            // --- Update Firestore ---
            await updateDoc(obraRef, { pedidos: obraToUpdate.pedidos });

            showToast("Comentário excluído com sucesso.");
            logInteraction('delete_comment', { etapaId: currentInfoEtapaId, commentIndex });
            const etapaIdentifier = getEtapaLogIdentifier(pedidoToUpdate, currentInfoEtapaId);
            await logActivity(targetObra.id, `removeu um comentário na etapa ${etapaIdentifier}.`);
            // UI updates via onSnapshot

        } catch (error) {
            console.error("Erro ao excluir comentário:", error);
            showToast("Falha ao excluir comentário.", "error");
        }
    });
};

const handleEditComentario = (commentIndex) => {
    // Find the comment item in the DOM using the original index
    const commentItem = document.querySelector(`.comment-item[data-index="${commentIndex}"]`);
    if (!commentItem || commentItem.querySelector('textarea')) return; // Already in edit mode or not found

    const textP = commentItem.querySelector('.comment-text');
    const actionsDiv = commentItem.querySelector('.comment-actions');
    const originalText = textP.textContent;

    // Hide the original text and action buttons
    textP.style.display = 'none';
    if(actionsDiv) actionsDiv.style.display = 'none';

    // Create textarea and save/cancel buttons for editing
    const editContainer = document.createElement('div');
    editContainer.className = 'mt-2';
    editContainer.innerHTML = `
        <textarea class="w-full p-2 border bg-gray-600 border-gray-500 rounded-lg text-white text-sm" rows="3">${originalText}</textarea>
        <div class="flex justify-end gap-2 mt-2">
            <button class="cancel-edit-btn bg-gray-500 hover:bg-gray-400 text-white font-bold py-1 px-3 rounded-lg text-xs">Cancelar</button>
            <button class="save-edit-btn bg-blue-600 hover:bg-blue-700 text-white font-bold py-1 px-3 rounded-lg text-xs">Salvar</button>
        </div>
    `;
    commentItem.appendChild(editContainer); // Add editing controls to the comment item

    // --- Add Event Listeners for Edit Controls ---
    editContainer.querySelector('.cancel-edit-btn').addEventListener('click', () => {
        // Remove editing controls and restore original view
        editContainer.remove();
        textP.style.display = 'block';
        if(actionsDiv) actionsDiv.style.display = 'flex';
    });

    editContainer.querySelector('.save-edit-btn').addEventListener('click', async () => {
        const newText = editContainer.querySelector('textarea').value.trim();
        // Save only if text is changed and not empty
        if (newText && newText !== originalText) {
            await saveEditedComentario(commentIndex, newText);
            // No need to manually update UI here, onSnapshot will handle it
        } else {
            // If text is unchanged or empty, just cancel the edit
            editContainer.remove();
            textP.style.display = 'block';
            if(actionsDiv) actionsDiv.style.display = 'flex';
        }
    });
};

const saveEditedComentario = async (commentIndex, newText) => {
    const [targetObra, targetPedido, ] = findEtapaParents(currentInfoEtapaId);
    if (!targetObra || !targetPedido) {
        showToast("Erro ao salvar: Obra ou Pedido não encontrado.", "error");
        return;
    }

    try {
        const obraRef = doc(obrasCollection, targetObra.id);
        // --- Fetch latest data ---
        const obraSnap = await getDoc(obraRef);
        if (!obraSnap.exists()) throw new Error("Obra não encontrada para editar comentário.");

        const obraToUpdate = obraSnap.data();
        const pedidoToUpdate = obraToUpdate.pedidos.find(p => p.id === targetPedido.id);
         if (!pedidoToUpdate) throw new Error("Pedido não encontrado.");
        const etapaToUpdate = pedidoToUpdate.etapas.find(e => e.id === currentInfoEtapaId);
         if (!etapaToUpdate || !etapaToUpdate.comentarios) throw new Error("Etapa ou comentários não encontrados.");

        const comentarioToUpdate = etapaToUpdate.comentarios[commentIndex];
        if (!comentarioToUpdate) throw new Error("Comentário no índice não encontrado.");

         // --- Permission Check ---
        if (currentUser.perfil !== 'admin' && currentUser.nome !== comentarioToUpdate.user) {
            showToast("Você não tem permissão para editar este comentário.", "error");
            // Find the edit container and trigger cancel (to restore UI)
             const commentItem = document.querySelector(`.comment-item[data-index="${commentIndex}"]`);
             const editContainer = commentItem?.querySelector('textarea')?.closest('div');
             editContainer?.querySelector('.cancel-edit-btn')?.click();
            return;
        }

        // --- Update comment data ---
        comentarioToUpdate.texto = newText;
        comentarioToUpdate.editadoEm = new Date(); // Add/update edited timestamp

        // --- Save to Firestore ---
        await updateDoc(obraRef, { pedidos: obraToUpdate.pedidos });

        showToast("Comentário atualizado com sucesso.");
        logInteraction('edit_comment', { etapaId: currentInfoEtapaId, commentIndex });
        const etapaIdentifier = getEtapaLogIdentifier(pedidoToUpdate, currentInfoEtapaId);
        await logActivity(targetObra.id, `editou um comentário na etapa ${etapaIdentifier}.`);
        // UI updates via onSnapshot

    } catch (error) {
        console.error("Erro ao salvar edição do comentário:", error);
        showToast("Falha ao salvar edição.", "error");
         // Attempt to restore UI if save failed
         const commentItem = document.querySelector(`.comment-item[data-index="${commentIndex}"]`);
         const editContainer = commentItem?.querySelector('textarea')?.closest('div');
         editContainer?.querySelector('.cancel-edit-btn')?.click();
    }
};

const renderLogisticaList = (logisticaItems = []) => {
    const container = document.getElementById('logisticaContainer');
    container.innerHTML = '';
    // Show placeholder if list is empty
    if (logisticaItems.length === 0) {
         container.innerHTML = '<p class="text-xs text-gray-500 text-center py-2">Nenhum veículo adicionado.</p>';
         return;
    }
    // Render each logistics item row
    logisticaItems.forEach((item, index) => {
        const el = document.createElement('div');
        el.className = 'grid grid-cols-12 gap-2 items-center';
        el.innerHTML = `
            <input type="text" value="${item.carro || ''}" placeholder="Carro" class="logistica-carro col-span-4 p-1 text-sm bg-gray-700 border-gray-600 rounded">
            <input type="text" value="${item.motorista || ''}" placeholder="Motorista" class="logistica-motorista col-span-4 p-1 text-sm bg-gray-700 border-gray-600 rounded">
            <input type="datetime-local" value="${item.saida || ''}" class="logistica-saida col-span-3 p-1 text-sm bg-gray-700 border-gray-600 rounded">
            <button type="button" class="remove-logistica-btn action-btn text-red-500 hover:text-red-400"><svg class="h-5 w-5 pointer-events-none" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5 10a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1z" clip-rule="evenodd" /></svg></button>
        `;
        container.appendChild(el);
    });
}
const renderProcedimentos = (procedimentosData) => {
    const container = document.getElementById('procedimentosContainer');
    container.innerHTML = '';
    // Determine if fields should be read-only based on user profile
    const isReadOnly = currentUser.perfil === 'Normal' || currentUser.perfil === 'Visualizacao';

    // Render dropdown for each procedure defined in PROCEDIMENTOS_LIST
    PROCEDIMENTOS_LIST.forEach(proc => {
        const status = procedimentosData[proc.key] || 'Pendente'; // Default to 'Pendente'
        const el = document.createElement('div');
        el.className = 'flex items-center justify-between';
        el.innerHTML = `
            <label class="text-sm text-gray-300">${proc.label}</label>
            <select data-key="${proc.key}" class="procedimento-status bg-gray-700 border border-gray-600 text-white text-xs rounded-md p-1" ${isReadOnly ? 'disabled' : ''}>
                <option value="Pendente" ${status === 'Pendente' ? 'selected' : ''}>Pendente</option>
                <option value="OK" ${status === 'OK' ? 'selected' : ''}>OK</option>
                <option value="Cobrado" ${status === 'Cobrado' ? 'selected' : ''}>Cobrado</option>
                <option value="N/A" ${status === 'N/A' ? 'selected' : ''}>N/A</option> // Added N/A option
            </select>
        `;
        container.appendChild(el);
    });
};
const renderHotelLists = (alocadosIds = [], hotelaria = {}) => {
    // Destroy previous Sortable instances for hotel lists
    activeHotelSortables.forEach(s => s.destroy());
    activeHotelSortables = [];

    // Get IDs currently assigned to each room type
    const idLists = {
        individual: hotelaria.individual || [],
        duplo: hotelaria.duplo || [],
        triplo: hotelaria.triplo || []
    };

    // --- Determine Employees Still to be Allocated to Rooms ---
    const groupedAlocados = {}; // Grouped by company
    let aAlocarCount = 0;
    alocadosIds.forEach(funcId => {
        // Check if employee is NOT in any room list
        if (!idLists.individual.includes(funcId) && !idLists.duplo.includes(funcId) && !idLists.triplo.includes(funcId)) {
            aAlocarCount++;
            const func = funcionarios.find(f => f.id === funcId);
            if (func) {
                // Group by company for display
                const empresaId = func.empresa_id || 'sem_empresa';
                if (!groupedAlocados[empresaId]) groupedAlocados[empresaId] = [];
                groupedAlocados[empresaId].push(func);
            }
        }
    });

    const alocadosContainer = document.getElementById('hotelAlocadosList');
    alocadosContainer.innerHTML = ''; // Clear previous content

    // Sort company groups alphabetically
    const sortedEmpresaIds = Object.keys(groupedAlocados).sort((a, b) => {
        const nomeA = (empresas.find(e => e.id === a) || { nome: 'Sem Empresa' }).nome;
        const nomeB = (empresas.find(e => e.id === b) || { nome: 'Sem Empresa' }).nome;
        return nomeA.localeCompare(nomeB);
    });

    // Render each company group in the 'to be allocated' list
    sortedEmpresaIds.forEach(empresaId => {
         const empresaNome = (empresas.find(e => e.id === empresaId) || {nome: 'Sem Empresa'}).nome;
         const groupContainer = document.createElement('div');
         groupContainer.className = 'empresa-group !p-1 !mb-2'; // Compact group style
         const listEl = document.createElement('div');
         listEl.className = 'space-y-1 min-h-[5px] hotel-empresa-list'; // List within group
         groupContainer.innerHTML = `<h4 class="font-semibold text-blue-400 mb-1 text-xs px-1">${empresaNome}</h4>`;
         // Sort employees within group and create mini cards
         groupedAlocados[empresaId].sort((a,b) => a.nome.localeCompare(b.nome)).forEach(func => listEl.appendChild(createMiniColaboradorCard(func)));
         groupContainer.appendChild(listEl);
         alocadosContainer.appendChild(groupContainer);
         // Make the list within the group sortable
         activeHotelSortables.push(new Sortable(listEl, { group: 'hotel', animation: 150, onEnd: renderHotelListsFromDOM }));
    });
    // Make the main 'to be allocated' container a sortable target as well
    activeHotelSortables.push(new Sortable(alocadosContainer, { group: 'hotel', animation: 150, onAdd: renderHotelListsFromDOM }));

    // --- Render Room Lists ---
    const renderRoomList = (listId, funcIds) => {
        const container = document.getElementById(listId);
        container.innerHTML = ''; // Clear previous content
        // Add mini cards for each employee in the room list
        funcIds.forEach(funcId => {
            const func = funcionarios.find(f => f.id === funcId);
            if (func) container.appendChild(createMiniColaboradorCard(func));
        });
        // Add visual cue if the dropzone is empty
        container.classList.toggle('dropzone-empty', container.children.length === 0);
        // Make the room list sortable
        activeHotelSortables.push(new Sortable(container, { group: 'hotel', animation: 150, onEnd: renderHotelListsFromDOM }));
    };

    renderRoomList('hotelIndividualList', idLists.individual);
    renderRoomList('hotelDuploList', idLists.duplo);
    renderRoomList('hotelTriploList', idLists.triplo);

    // --- Update Stats Display ---
    const statsEl = document.getElementById('hotelStats');
    const numInd = idLists.individual.length;
    // Calculate estimated number of rooms needed for double/triple
    const numDup = Math.ceil(idLists.duplo.length / 2);
    const numTri = Math.ceil(idLists.triplo.length / 3);
    statsEl.innerHTML = `
        <span>A alocar: <strong class="text-white">${aAlocarCount}</strong></span> |
        <span>Total quartos: <strong class="text-white">${numInd + numDup + numTri}</strong></span>
        (I: <strong class="text-white">${numInd}</strong>, D: <strong class="text-white">${numDup}</strong>, T: <strong class="text-white">${numTri}</strong>)
    `;
};
const renderHotelListsFromDOM = () => {
     // Helper function to re-render hotel lists based on the current state of the DOM
     // Called after a drag-and-drop operation ends
     const getIds = (elementId) => Array.from(document.querySelectorAll(`#${elementId} .colaborador-card`)).map(c => c.dataset.id);
     // Read the employee IDs from each list in the DOM
     const hotelaria = {
        individual: getIds('hotelIndividualList'),
        duplo: getIds('hotelDuploList'),
        triplo: getIds('hotelTriploList'),
     };
     const etapaId = document.getElementById('infoEtapaId').value;
     const [,,etapa] = findEtapaParents(etapaId);
     if (etapa) {
        // Re-render using the IDs read from DOM and the original list of alocados
        renderHotelLists(etapa.colaboradores_alocados || [], hotelaria);
     }
}
const saveInfoEtapa = async () => {
     if (currentUser.perfil === 'Visualizacao') { showToast("Não permitido.", 'error'); return; }

     const etapaId = document.getElementById('infoEtapaId').value;
     const [targetObra, targetPedido, targetEtapa] = findEtapaParents(etapaId);

    if (!targetEtapa) { console.error("Não foi possível salvar, etapa não encontrada"); return; }

    // --- Gather data from form fields ---
    const infoData = {
        clienteTelefone: document.getElementById('infoClienteTelefone').value,
        clienteEmail: document.getElementById('infoClienteEmail').value,
        encarregado: document.getElementById('infoEncarregado').value,
        descricao: document.getElementById('infoDescricao').value,
        // Read logistics data
        logistica: Array.from(document.querySelectorAll('#logisticaContainer > div')).map(el => ({
            carro: el.querySelector('.logistica-carro').value,
            motorista: el.querySelector('.logistica-motorista').value,
            saida: el.querySelector('.logistica-saida').value,
        })).filter(item => item.carro || item.motorista || item.saida), // Filter out empty rows
        // Read hotel allocation data from DOM
        hotelaria: {
            individual: Array.from(document.getElementById('hotelIndividualList').querySelectorAll('.colaborador-card')).map(c => c.dataset.id),
            duplo: Array.from(document.getElementById('hotelDuploList').querySelectorAll('.colaborador-card')).map(c => c.dataset.id),
            triplo: Array.from(document.getElementById('hotelTriploList').querySelectorAll('.colaborador-card')).map(c => c.dataset.id),
        }
    };

    // --- Read procedure data only if user has permission ---
    if (currentUser.perfil === 'admin' || currentUser.perfil === 'RH') {
        const procedimentos = {};
        document.querySelectorAll('.procedimento-status').forEach(select => {
            procedimentos[select.dataset.key] = select.value;
        });
        procedimentos.responsavel = document.getElementById('infoResponsavelNome').value;
        infoData.procedimentos = procedimentos;
    } else {
        // If user doesn't have permission, ensure existing procedures are preserved
        infoData.procedimentos = targetEtapa.procedimentos || {};
    }

    // --- Prepare update data ---
    const obraToUpdate = obras.find(o => o.id === targetObra.id);
    const updatedPedidos = JSON.parse(JSON.stringify(obraToUpdate.pedidos)); // Deep copy
    const pedidoToUpdate = updatedPedidos.find(p => p.id === targetPedido.id);
    const etapaToUpdate = (pedidoToUpdate.etapas || []).find(e => e.id === etapaId);

    // Merge new data into the etapa object
    Object.assign(etapaToUpdate, infoData);

    try {
        // --- Save to Firestore ---
        const obraRef = doc(obrasCollection, obraToUpdate.id);
        await updateDoc(obraRef, { pedidos: updatedPedidos });
        logInteraction('save_info_etapa', { etapaId, data: infoData });
        const etapaIdentifier = getEtapaLogIdentifier(pedidoToUpdate, etapaToUpdate.id);
        await logActivity(targetObra.id, `atualizou as informações da etapa ${etapaIdentifier} do pedido "${targetPedido.numero}".`);

        closeModal(document.getElementById('infoEtapaModal'));
        showToast(`Informações da etapa "${etapaToUpdate.nome}" salvas.`);
    } catch(error) {
        console.error("Erro ao salvar informações da etapa: ", error);
        logInteraction('error_save_info_etapa', { error });
        showToast("Falha ao salvar informações.", "error");
    }
}
const openEmpresaModal = (empresa = {}) => {
    const form = document.getElementById('empresaForm');
    form.reset();
    document.getElementById('empresaId').value = empresa.id || '';
    document.getElementById('empresaModalTitle').textContent = empresa.id ? `Editar Empresa: ${empresa.nome}` : 'Nova Empresa';
    document.getElementById('empresaNome').value = empresa.nome || '';
    document.getElementById('empresaTipo').value = empresa.tipo || 'Terceirizada'; // Default to Terceirizada
    openModal(document.getElementById('empresaModal'));
};
const openFuncionarioModal = (func = {}) => {
    const form = document.getElementById('funcionarioForm');
    form.reset();
    document.getElementById('funcionarioId').value = func.id || '';
    // Pre-select the company if adding from the context of a selected company
    document.getElementById('funcionarioEmpresaId').value = func.empresa_id || selectedEmpresaId;
    document.getElementById('funcionarioModalTitle').textContent = func.id ? `Editar Funcionário: ${func.nome}` : 'Novo Funcionário';
    document.getElementById('funcionarioNome').value = func.nome || '';
    document.getElementById('funcionarioCargo').value = func.cargo || '';
    // Populate integration fields
    document.getElementById('funcionarioIntegracaoBRF').value = func.integracaoBRF || '';
    document.getElementById('funcionarioIntegracaoJBS').value = func.integracaoJBS || '';
    openModal(document.getElementById('funcionarioModal'));
};
const updateObraLabelBtn = () => {
    // Update the text on the label toggle buttons based on the current `obraLabelType`
    const text = obraLabelType === 'numero' ? 'Nº Projeto' : 'Nome Projeto';
    const btn1 = document.getElementById('toggleObraLabelBtn');
    if(btn1) btn1.textContent = text;
    const btn2 = document.getElementById('toggleColaboradorLabelBtn');
    if(btn2) btn2.textContent = text;
};

const generateEtapaReport = (etapaId) => {
    // Find the initial etapa and its context
    const [parentObra, parentPedido, initialEtapa] = findEtapaParents(etapaId);
    if (!initialEtapa) { showToast('Erro ao gerar relatório: Etapa não encontrada.', 'error'); return; }

    // Get all etapas belonging to the same group (same name)
    const etapasDoGrupo = (parentPedido.etapas || []).filter(e => e.nome === initialEtapa.nome).sort((a,b) => new Date(a.data_inicio) - new Date(b.data_inicio));

    const wb = XLSX.utils.book_new(); // Create a new workbook
    const reportData = []; // Array to hold all rows of data

    // --- Header ---
    reportData.push([`RELATÓRIO DE ETAPA AGRUPADA: ${initialEtapa.nome}`]);
    reportData.push([]); // Empty row for spacing
    reportData.push(["Projeto:", parentObra.nome, "", "Número:", parentObra.numero]);
    reportData.push(["Cliente:", parentObra.cliente, "", "Pedido:", parentPedido.numero]);
    reportData.push([]); // Empty row

    // --- Iterate through each task in the group ---
    etapasDoGrupo.forEach((etapa, index) => {
        reportData.push([`--- TAREFA ${index + 1} de ${etapasDoGrupo.length} ---`]);
        reportData.push(["Período:", `${etapa.data_inicio || 'N/A'} a ${etapa.data_fim || 'N/A'}`]);
        reportData.push(["DESCRIÇÃO DO SERVIÇO"]);
        reportData.push([etapa.descricao || 'Nenhuma descrição fornecida.']);
        reportData.push([]);

        reportData.push(["INFORMAÇÕES ADICIONAIS"]);
        reportData.push(["Encarregado da Obra:", etapa.encarregado || 'N/A']);
        reportData.push(["Telefone Cliente:", etapa.clienteTelefone || 'N/A']);
        reportData.push(["Email Cliente:", etapa.clienteEmail || 'N/A']);
        reportData.push(["Responsável Procedimentos:", etapa.procedimentos?.responsavel || 'N/A']);
        reportData.push([]);

        // --- Alocados Section ---
        const alocadosIds = etapa.colaboradores_alocados || [];
        reportData.push([`COLABORADORES ALOCADOS (${alocadosIds.length})`]);
        if (alocadosIds.length > 0) {
            reportData.push(["Nome", "Cargo", "Empresa", "Status de Conflito"]); // Headers
            alocadosIds.forEach(funcId => {
                const func = funcionarios.find(f => f.id === funcId);
                const emp = func ? empresas.find(e => e.id === func.empresa_id) : null;
                // Check for conflicts related to this specific etapa and employee
                const etapaConflicts = conflictMap.get(etapa.id);
                let conflictStatus = "Sem conflito";
                if (etapaConflicts && etapaConflicts.has(funcId)) {
                    conflictStatus = etapaConflicts.get(funcId); // Get conflict message
                }
                reportData.push([
                    func?.nome || 'Desconhecido',
                    func?.cargo || 'N/A',
                    emp?.nome || 'N/A',
                    conflictStatus
                ]);
            });
        } else {
            reportData.push(["Nenhum colaborador alocado."]);
        }
        reportData.push([]); // Empty row
        reportData.push([]); // Extra empty row between tasks
    });

    const ws = XLSX.utils.aoa_to_sheet(reportData); // Convert array of arrays to worksheet

    // --- Auto-adjust Column Widths (basic approach) ---
    const columnWidths = reportData.reduce((widths, row) => {
        (row || []).forEach((cell, i) => {
            const cellValue = cell ? String(cell) : '';
            const len = cellValue.length;
            if (!widths[i] || len > widths[i]) {
                widths[i] = len; // Track max length for each column
            }
        });
        return widths;
    }, []);
    // Apply widths with padding and max width limit
    ws['!cols'] = columnWidths.map(width => ({ wch: Math.min(Math.max(width, 10) + 2, 80) }));

    XLSX.utils.book_append_sheet(wb, ws, "Relatório da Etapa"); // Add worksheet to workbook
    // Generate and trigger download
    XLSX.writeFile(wb, `Relatorio_Etapa_${initialEtapa.nome.replace(/\s/g, '_')}.xlsx`);
    showToast('Relatório da etapa gerado com sucesso!');
};

const generateObraReport = (obraId) => {
    const obra = obras.find(o => o.id === obraId);
    if (!obra) { showToast('Erro: Projeto não encontrado.', 'error'); return; }

    const wb = XLSX.utils.book_new();
    const reportData = [];

    // --- Calculate Summary Stats ---
    const todasEtapas = (obra.pedidos || []).flatMap(p => p.etapas || []);
    const allColabIds = new Set(todasEtapas.flatMap(e => e.colaboradores_alocados || [])); // Unique collaborators
    const hasConflicts = todasEtapas.some(e => conflictMap.has(e.id)); // Any conflicts in the project?
    let totalQuartos = 0;
    todasEtapas.forEach(e => { // Calculate total estimated rooms
        totalQuartos += (e.hotelaria?.individual?.length || 0);
        totalQuartos += Math.ceil((e.hotelaria?.duplo?.length || 0) / 2);
        totalQuartos += Math.ceil((e.hotelaria?.triplo?.length || 0) / 3);
    });

    // --- Header and Summary ---
    reportData.push(["RELATÓRIO GERAL DO PROJETO"]);
    reportData.push([]);
    reportData.push(["Projeto:", obra.nome]);
    reportData.push(["Número:", obra.numero]);
    reportData.push(["Cliente:", obra.cliente]);
    reportData.push([]);
    reportData.push(["SUMÁRIO GERAL"]);
    reportData.push(["Total de Colaboradores Únicos:", allColabIds.size]);
    reportData.push(["Total de Quartos Estimados:", totalQuartos]);
    reportData.push(["Status de Conflitos:", hasConflicts ? "CONFLITOS DETECTADOS" : "Sem conflitos"]);
    reportData.push([]);

    // --- Detailed Schedule and Allocation ---
    reportData.push(["CRONOGRAMA DETALHADO E ALOCAÇÕES"]);
    reportData.push(["Pedido", "Etapa", "Início", "Fim", "Nome do Colaborador", "Função", "Empresa"]); // Headers

    // Iterate through sorted pedidos and etapas
    (obra.pedidos || []).sort((a,b) => (a.numero || '').localeCompare(b.numero || '', undefined, {numeric: true})).forEach(p => {
        (p.etapas || []).sort((a,b) => new Date(a.data_inicio) - new Date(b.data_inicio)).forEach(e => {
            const alocados = e.colaboradores_alocados || [];
            if (alocados.length > 0) {
                // Add a row for each allocated employee
                alocados.forEach(funcId => {
                    const func = funcionarios.find(f => f.id === funcId);
                    const emp = func ? empresas.find(em => em.id === func.empresa_id) : null;
                    reportData.push([ p.numero, e.nome, e.data_inicio, e.data_fim, func?.nome || 'ID não encontrado', func?.cargo || 'N/A', emp?.nome || 'N/A' ]);
                });
            } else {
                // Add a row indicating no allocation if empty
                reportData.push([p.numero, e.nome, e.data_inicio, e.data_fim, "(Nenhum colaborador alocado)", "", ""]);
            }
        });
    });

    const ws = XLSX.utils.aoa_to_sheet(reportData);

    // --- Auto-adjust Column Widths ---
    const columnWidths = reportData.reduce((widths, row) => {
        (row || []).forEach((cell, i) => {
            const cellValue = cell ? String(cell) : '';
            const len = cellValue.length;
            if (!widths[i] || len > widths[i]) {
                widths[i] = len;
            }
        });
        return widths;
    }, []);
    ws['!cols'] = columnWidths.map(width => ({ wch: Math.min(Math.max(width, 10) + 2, 80) }));

    XLSX.utils.book_append_sheet(wb, ws, "Relatório do Projeto");
    XLSX.writeFile(wb, `Relatorio_Projeto_${obra.nome.replace(/\s/g, '_')}.xlsx`);
    showToast('Relatório do projeto gerado com sucesso!');
}

const updateUIPermissions = () => {
    const perfil = currentUser?.perfil;
    if (!perfil) return; // Exit if user profile is not defined

    const isVisualizacao = perfil === 'Visualizacao';
    const isAdmin = perfil === 'admin';
    const isRH = perfil === 'RH';

    // --- Global Controls ---
    document.getElementById('settingsBtn').classList.toggle('hidden', !isAdmin); // Only admin sees settings

    // --- Buttons to Disable for Visualizacao ---
    const elementsToDisable = [
        '#addObraBtn', '#addEmpresaBtn', '#saveObraBtn', '#saveEmpresaBtn',
        '#saveFuncionarioBtn', '#saveAlocacaoBtn', '#saveInfoEtapaBtn', '#saveFechamentoBtn',
        '#deleteObraBtn', '#addPedidoBtn', '#addPendenciaBtn', '#addLogisticaBtn',
        '#confirmVisualizacaoBtn', // Although logic hides it, disable for safety
        '#userForm button[type=submit]', '#clearUserFormBtn' // User management buttons
    ];

    elementsToDisable.forEach(selector => {
        const el = document.querySelector(selector);
        if (el) el.disabled = isVisualizacao;
    });

    // --- Buttons/Links to Hide for Visualizacao ---
     document.querySelectorAll('.edit-btn, .delete-btn, #addFuncionarioBtn, .remove-pedido-btn, .remove-etapa-btn, .copy-etapa-btn, .remove-logistica-btn, .remove-pendencia-btn, .edit-comment-btn, .delete-comment-btn, .edit-user-btn, .delete-user-btn, #copyAllocationsBtn').forEach(btn => {
        btn.style.display = isVisualizacao ? 'none' : ''; // Use '' to revert to default display
    });

    // --- Make Inputs/Textareas/Selects Readonly/Disabled for Visualizacao ---
    document.querySelectorAll('input, textarea, select').forEach(el => {
        // Exclude login form elements and search inputs
        if(!el.closest('#loginForm') && el.id !== 'globalSearchInput' && el.id !== 'alocacaoSearch' && !el.id.startsWith('integracaoFiltro')) {
            
            // v11.0: NÃO desabilita os selects de ordenação para 'Visualizacao'
            if (el.tagName === 'SELECT' && (el.id === 'obraSort' || el.id === 'colaboradorSort' || el.id === 'integracaoSort' || el.id === 'sortAlocacao')) {
                el.disabled = false;
                el.readOnly = false; // Apenas para garantir
                return; // Pula para o próximo elemento
            }
            // Fim da modificação v11.0

            el.readOnly = isVisualizacao;
            // Select elements need to be disabled, not just readonly
            if(el.tagName === 'SELECT') el.disabled = isVisualizacao;
            // Also disable checkboxes used as filters in 'Alocacao' and 'Integracoes'
            if(el.type === 'checkbox' && (el.id.startsWith('filtro') || el.id.startsWith('integracaoFiltro'))) {
                 // Keep filters enabled for Visualizacao
                 el.disabled = false; // Override disable for filters
                 el.readOnly = false;
            } else if (el.type === 'checkbox') {
                 el.disabled = isVisualizacao;
            }
        }
    });

    // Ensure specific read-only fields remain so even for other roles
    document.getElementById('infoClienteNome').readOnly = true;

    // --- Specific Controls for RH/Normal ---
    const canEditProcedures = isAdmin || isRH;
    // Disable procedure dropdowns and responsible input if not Admin/RH
    document.querySelectorAll('.procedimento-status').forEach(sel => sel.disabled = isVisualizacao || !canEditProcedures);
    document.getElementById('infoResponsavelNome').readOnly = isVisualizacao || !canEditProcedures;

    // --- Draggability ---
    // Disable SortableJS dragging for Visualizacao profile (more complex, might need library-specific methods if just disabling isn't enough)
     if (ganttSidebarSortable) ganttSidebarSortable.option('disabled', isVisualizacao);
     activeProjectsSortables.forEach(s => s.option('disabled', isVisualizacao));
     activeAlocacaoSortables.forEach(s => s.option('disabled', isVisualizacao));
     activeHotelSortables.forEach(s => s.option('disabled', isVisualizacao));

     // Make Gantt bars non-resizable/draggable for Visualizacao
     // Handled within the mousedown listener logic by checking currentUser.perfil

     // Comment form
     const commentForm = document.getElementById('comentarioForm');
     if (commentForm) {
         commentForm.querySelector('textarea').disabled = isVisualizacao;
         commentForm.querySelector('button').disabled = isVisualizacao;
     }

};

const openFechamentoModal = (obraId) => {
    const obra = obras.find(o => o.id === obraId);
    if(!obra) return; // Exit if obra not found

    // Populate modal fields with obra data
    document.getElementById('fechamentoObraId').value = obraId;
    document.getElementById('fechamentoModalTitle').textContent = `Fechamento / Pendências: ${obra.nome}`;
    document.getElementById('fechamentoObservacoes').value = obra.observacoes || '';
    document.getElementById('obraFinalizadaCheckbox').checked = obra.finalizada || false;

    // --- Render Pendencias List ---
    const list = document.getElementById('pendenciasList');
    list.innerHTML = ''; // Clear previous items
    (obra.pendencias || []).forEach((p, index) => {
        const pendenciaEl = document.createElement('div');
        pendenciaEl.className = 'flex items-center justify-between bg-gray-700/50 p-2 rounded';
        pendenciaEl.innerHTML = `
            <div class="flex items-center flex-grow mr-2">
                <input id="pendencia-${index}" type="checkbox" ${p.concluida ? 'checked' : ''} class="h-4 w-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500 pendencia-checkbox flex-shrink-0" data-index="${index}">
                <label for="pendencia-${index}" class="ml-2 ${p.concluida ? 'line-through text-gray-500' : ''} break-words">${p.texto}</label>
            </div>
            <button class="remove-pendencia-btn action-btn text-red-500 flex-shrink-0" data-index="${index}">
                <svg class="h-5 w-5 pointer-events-none" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5 10a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1z" clip-rule="evenodd"></path></svg>
            </button>
        `;
        list.appendChild(pendenciaEl);
    });

    openModal(document.getElementById('fechamentoModal'));
};

const saveFechamento = async () => {
     if (currentUser.perfil === 'Visualizacao') { showToast("Não permitido.", 'error'); return; }
     const obraId = document.getElementById('fechamentoObraId').value;
     const obra = obras.find(o => o.id === obraId);
     if (!obra) return;

     // --- Read pendencias data from the DOM ---
     const pendencias = Array.from(document.getElementById('pendenciasList').children).map((el) => {
        // Find the label safely, even if structure changes slightly
        const label = el.querySelector('label');
        const checkbox = el.querySelector('input[type=checkbox]');
        return {
            texto: label ? label.textContent : '', // Get text content of the label
            concluida: checkbox ? checkbox.checked : false // Get checked state
        }
     }).filter(p => p.texto); // Filter out any potentially empty items if needed

     // --- Gather all data to save ---
     const data = {
        pendencias: pendencias,
        observacoes: document.getElementById('fechamentoObservacoes').value,
        finalizada: document.getElementById('obraFinalizadaCheckbox').checked,
        lastUpdate: new Date() // Add timestamp for last update
     };

     try {
        // --- Update Firestore ---
        await updateDoc(doc(obrasCollection, obraId), data);
        // Log if the 'finalizada' status changed
        if (obra.finalizada !== data.finalizada) {
            await logActivity(obraId, `marcou a obra como ${data.finalizada ? 'Finalizada' : 'Não Finalizada'}.`);
        }
         // Log changes in pendencies (more complex, could compare arrays) - Skipped for brevity
         if (obra.observacoes !== data.observacoes) {
              await logActivity(obraId, `atualizou as observações de fechamento.`);
         }
        showToast("Dados de fechamento salvos com sucesso!");
        closeModal(document.getElementById('fechamentoModal'));
     } catch(e) {
        console.error("Erro ao salvar fechamento: ", e);
        showToast("Erro ao salvar dados.", 'error');
     }
};

const openActivityLogModal = (obraId) => {
    const obra = obras.find(o => o.id === obraId);
    if (!obra) return;
    document.getElementById('activityLogModalTitle').textContent = `Histórico: ${obra.nome}`;
    const container = document.getElementById('activityLogContainer');
    container.innerHTML = '<p class="text-gray-400">Carregando histórico...</p>'; // Loading state

    // Sort logs by timestamp, most recent first
    const logs = [...(obra.activityLog || [])].sort((a,b) => {
         const dateA = a.timestamp?.toDate ? a.timestamp.toDate() : (a.timestamp instanceof Date ? a.timestamp : new Date(0));
         const dateB = b.timestamp?.toDate ? b.timestamp.toDate() : (b.timestamp instanceof Date ? b.timestamp : new Date(0));
         return dateB - dateA;
    });

    // Render logs or placeholder
    if (logs.length === 0) {
        container.innerHTML = '<p class="text-gray-400">Nenhuma atividade registrada para este projeto.</p>';
    } else {
        container.innerHTML = logs.map(log => {
            const date = log.timestamp?.toDate ? log.timestamp.toDate().toLocaleString('pt-BR') : (log.timestamp instanceof Date ? log.timestamp.toLocaleString('pt-BR') : 'Data inválida');
            return `<div class="bg-gray-700/50 p-2 rounded">
                <p class="text-sm text-white"><strong class="font-semibold">${log.user}</strong> ${log.message}</p>
                <p class="text-xs text-gray-400 text-right">${date}</p>
            </div>`;
        }).join('');
    }

    openModal(document.getElementById('activityLogModal'));
};

const openSettingsModal = () => {
    if (currentUser?.perfil !== 'admin') { // Double check permission
        showToast("Acesso negado.", "error");
        return;
    }
    renderUserList(); // Populate user list
    clearUserForm(); // Reset the add/edit form
    openModal(document.getElementById('settingsModal'));
};

const renderUserList = () => {
    const container = document.getElementById('userListContainer');
    container.innerHTML = '';
    // Sort users alphabetically and render
    users.sort((a, b) => a.nome.localeCompare(b.nome)).forEach(user => {
        const el = document.createElement('div');
        el.className = 'p-3 bg-gray-700/50 rounded flex justify-between items-center';
        el.innerHTML = `
            <div>
                <p class="font-semibold text-white">${user.nome}</p>
                <p class="text-sm text-gray-400">${user.login} - <span class="font-medium">${user.perfil}</span></p>
            </div>
             <div class="flex gap-2">
                <button class="edit-user-btn action-btn" data-id="${user.id}"><svg class="h-5 w-5 pointer-events-none" viewBox="0 0 20 20" fill="currentColor"><path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" /><path fill-rule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clip-rule="evenodd" /></svg></button>
                <button class="delete-user-btn action-btn" data-id="${user.id}"><svg class="h-5 w-5 pointer-events-none" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V8z" clip-rule="evenodd" /></svg></button>
            </div>
        `;
        container.appendChild(el);
    });
};

const clearUserForm = () => {
     // Reset the user form to its default state for adding a new user
     document.getElementById('userForm').reset();
     document.getElementById('userId').value = ''; // Clear hidden ID field
     document.getElementById('userSenha').required = true; // Make password required for new users
     document.getElementById('userSenha').placeholder = 'Senha (obrigatória para novo usuário)'; // Update placeholder
     document.getElementById('userFormTitle').textContent = 'Adicionar Novo Usuário'; // Reset title
};

const handleUserForm = async (e) => {
    e.preventDefault();
    if (currentUser?.perfil !== 'admin') {
        showToast("Apenas Admin pode gerenciar usuários.", "error");
        return;
    }
    const id = document.getElementById('userId').value; // Get ID (if editing)
    const senha = document.getElementById('userSenha').value;

    // Password validation for new users
    if (!id && !senha) {
        showToast("A senha é obrigatória para novos usuários.", "error");
        document.getElementById('userSenha').focus();
        return;
    }

    // Gather user data from form
    const userData = {
        nome: document.getElementById('userNome').value.trim(),
        login: document.getElementById('userLogin').value.toLowerCase().trim(), // Store login as lowercase
        perfil: document.getElementById('userPerfil').value,
    };

    if (!userData.nome || !userData.login) {
        showToast("Nome e Login são obrigatórios.", "error");
        return;
    }

    // Add password only if provided (for new users or password change)
    if (senha) {
        // !! SECURITY WARNING !!
        // Storing passwords in plain text (even in Firestore) is highly insecure.
        // This should be replaced with Firebase Authentication for production.
        // For this implementation, we'll store it as provided, but acknowledge the risk.
        console.warn("SECURITY WARNING: Storing password in plain text.");
        userData.senha = senha;
    }

    try {
        if(id) { // Update existing user
            // Ensure admin cannot accidentally remove their own admin rights
            if (id === currentUser.id && userData.perfil !== 'admin') {
                 showToast("Não é possível remover o próprio status de Administrador.", "error");
                 // Revert profile dropdown if necessary
                 document.getElementById('userPerfil').value = 'admin';
                 return;
            }
            await setDoc(doc(usersCollection, id), userData, { merge: true }); // Merge to avoid overwriting fields not in form
            showToast("Usuário atualizado com sucesso!");
        } else { // Create new user
             // Check if login already exists
            const existingUser = users.find(u => u.login === userData.login);
            if (existingUser) {
                showToast(`Erro: Login "${userData.login}" já está em uso.`, "error");
                document.getElementById('userLogin').focus();
                return;
            }
            await addDoc(usersCollection, userData);
            showToast("Usuário criado com sucesso!");
        }
        clearUserForm(); // Reset form after successful save
        // User list will update via onSnapshot
    } catch(error) {
        console.error("Erro ao salvar usuário:", error);
        showToast("Erro ao salvar usuário.", "error");
    }
};

const saveUserPreferences = async () => {
    if (!currentUser) return; // Only save if a user is logged in
    // Gather preferences from UI elements
    const prefs = {
        zoomLevel: zoomLevel,
        obraSort: document.getElementById('obraSort').value,
        colaboradorSort: document.getElementById('colaboradorSort').value,
        obraLabelType: obraLabelType,
        expandedState: ganttExpandedState // Save the current expanded/collapsed state of Gantt items
    };
    try {
        // Save preferences to Firestore under the current user's ID
        await setDoc(doc(userPreferencesCollection, currentUser.id), prefs);
        logInteraction('save_preferences', prefs);
    } catch (error) {
        console.error("Erro ao salvar preferências:", error);
        // Optionally notify user of failure
        // showToast("Falha ao salvar preferências.", "error");
    }
};

const loadUserPreferences = async () => {
     if (!currentUser) return; // Only load if a user is logged in
     try {
        const docRef = doc(userPreferencesCollection, currentUser.id);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            const prefs = docSnap.data();
            // Apply loaded preferences, using defaults if a preference is missing
            zoomLevel = prefs.zoomLevel ?? zoomLevel;
            document.getElementById('obraSort').value = prefs.obraSort || 'proximas';
            document.getElementById('colaboradorSort').value = prefs.colaboradorSort || 'proximas';
            obraLabelType = prefs.obraLabelType || 'numero';
            ganttExpandedState = prefs.expandedState || {};
            updateObraLabelBtn(); // Update button text based on loaded label type
            logInteraction('load_preferences', prefs);
        } else {
             logInteraction('load_preferences', { status: 'No preferences found, using defaults.' });
             // No preferences saved yet, use defaults (already set)
        }
     } catch (error) {
         console.error("Erro ao carregar preferências:", error);
         // Optionally notify user
         // showToast("Falha ao carregar suas preferências.", "error");
     }
};

const initialize = async () => {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);

    // [INÍCIO DA ADIÇÃO] - Lógica de Detecção do Emulador
    // Check if running on localhost (emulator environment)
    const isEmulator = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (isEmulator) {
        try {
            console.log("Modo Emulador Detectado. Conectando aos emuladores...");
            // Connect to default emulator ports
            // Firestore: 8080
            // Auth: 9099
            connectFirestoreEmulator(db, 'localhost', 8080);
            connectAuthEmulator(auth, 'http://localhost:9099');
            console.log("Conectado com sucesso aos Emuladores Firebase (Auth e Firestore).");
        } catch (e) {
            console.error("Falha ao conectar aos emuladores. Verifique se eles estão em execução.", e);
        }
    } else {
        console.log("Modo Produção. Conectando ao Firebase real.");
    }
    // [FIM DA ADIÇÃO]

    // --- Define Firestore Collection References ---
    // Using public data path structure
    obrasCollection = collection(db, `/artifacts/${appId}/public/data/obras`);
    funcionariosCollection = collection(db, `/artifacts/${appId}/public/data/funcionarios`);
    empresasCollection = collection(db, `/artifacts/${appId}/public/data/empresas`);
    settingsCollection = collection(db, `/artifacts/${appId}/public/data/settings`);
    usersCollection = collection(db, `/artifacts/${appId}/public/data/users`);
    userPreferencesCollection = collection(db, `/artifacts/${appId}/public/data/userPreferences`);
    notificacoesCollection = collection(db, `/artifacts/${appId}/public/data/notificacoes`);

    try {
        // Sign in anonymously initially. The login form handles actual user authentication.
        await signInAnonymously(auth);
        console.log("Signed in anonymously");
    } catch (error) {
        console.error("Anonymous sign-in failed", error);
        // Handle failure (e.g., show error message)
    }

     // --- Initial listener for users (needed for login) ---
    onSnapshot(query(usersCollection), snap => {
         users = snap.docs.map(d => ({id: d.id, ...d.data()}));
         // If settings modal is open, refresh the user list
         if (document.getElementById('settingsModal') && !document.getElementById('settingsModal').classList.contains('hidden')) {
            renderUserList();
         }
    }, error => {
        console.error("Error fetching users collection: ", error);
        // Handle error (e.g., show message to user)
    });

    // Hide loader and show login modal after basic setup
    const loader = document.getElementById('loader');
    if (loader) loader.style.display = 'none';
    const loginModal = document.getElementById('loginModal');
    if (loginModal) openModal(loginModal);
};

// ... Continuação da Parte 2, que terminou com:
//     const loginModal = document.getElementById('loginModal');
//     if (loginModal) openModal(loginModal);
// };

const startApp = async () => {
    // Load user preferences first
    await loadUserPreferences();

    // Load manual obra order
    try {
        const orderDoc = await getDoc(doc(settingsCollection, 'obraOrder'));
        if (orderDoc.exists()) {
            obraOrder = orderDoc.data().order || []; // Ensure it's an array
        }
    } catch (error) {
        console.error("Erro ao carregar ordem manual das obras:", error);
    }


    // Load active project IDs
    try {
        const activeProjectsDoc = await getDoc(doc(settingsCollection, 'activeProjects'));
        if (activeProjectsDoc.exists()) {
            activeProjectIds = activeProjectsDoc.data().ids || []; // Ensure it's an array
        }
    } catch (error) {
        console.error("Erro ao carregar projetos ativos:", error);
    }


    // --- Setup Firestore Listeners (onSnapshot) ---

    // Listener for Obras
    onSnapshot(query(obrasCollection), s => {
        obras = s.docs.map(d => ({ id: d.id, ...d.data() })); // Update global obras array

        // If no active projects are set, default to showing all projects (unless search is active)
        if (activeProjectIds.length === 0 && obras.length > 0 && !(document.getElementById('globalSearchInput') && document.getElementById('globalSearchInput').value)) {
            activeProjectIds = obras.map(o => o.id);
            // Save this default setting
            setDoc(doc(settingsCollection, 'activeProjects'), { ids: activeProjectIds })
                .catch(err => console.error("Erro ao salvar activeProjects padrão:", err));
        }

        calculateAllConflicts(); // Recalculate conflicts whenever obra data changes
        handleGlobalSearch(); // Re-apply search filter (which also triggers renderGanttChart if needed)
        if(currentTab === 'Dashboard') renderDashboard(); // Update dashboard if it's the current view

        // Refresh Info Etapa modal content if it's open and viewing an etapa from the updated data
        if (!document.getElementById('infoEtapaModal').classList.contains('hidden') && currentInfoEtapaId) {
            refreshInfoEtapaModalContent();
        }
    }, error => {
        console.error("Erro ao buscar coleção de obras:", error);
        showToast("Falha ao carregar dados das obras.", "error");
    });

    // Listener for Empresas
    onSnapshot(query(empresasCollection), s => {
        empresas = s.docs.map(d => ({ id: d.id, ...d.data() }));
        // Re-render relevant UI parts if the current tab requires empresa data
        if(currentTab === 'Gerenciamento') renderEmpresaList();
        if(currentTab === 'Integracoes') renderIntegracoesView(); // Added for new tab
        if(!document.getElementById('alocacaoModal').classList.contains('hidden')) renderAlocacaoLists(true); // Refresh alocacao if open
    }, error => {
        console.error("Erro ao buscar coleção de empresas:", error);
        showToast("Falha ao carregar dados das empresas.", "error");
    });

    // Listener for Funcionarios
    onSnapshot(query(funcionariosCollection), s => {
        funcionarios = s.docs.map(d => ({ id: d.id, ...d.data() }));
        calculateAllConflicts(); // Recalculate conflicts when employee data changes
        // Re-render relevant UI parts
        if (currentTab === 'Gerenciamento' && selectedEmpresaId) renderFuncionarioList();
        if (currentTab === 'Colaboradores') renderColaboradorView();
        // Avoid re-rendering Gantt unnecessarily if search is active (handleGlobalSearch does it)
        if (currentTab === 'Gantt' && !(document.getElementById('globalSearchInput') && document.getElementById('globalSearchInput').value)) {
             renderGanttChart();
        }
        if (currentTab === 'Dashboard') renderDashboard();
        if (currentTab === 'Integracoes') renderIntegracoesView(); // Added for new tab
        // Refresh alocacao modal if open
        if (!document.getElementById('alocacaoModal').classList.contains('hidden') && currentAlocacaoEtapaId) {
             renderAlocacaoLists(true);
        }
        // Refresh info modal if open (hotel lists depend on funcionario data)
         if (!document.getElementById('infoEtapaModal').classList.contains('hidden') && currentInfoEtapaId) {
             refreshInfoEtapaModalContent();
        }
    }, error => {
         console.error("Erro ao buscar coleção de funcionários:", error);
         showToast("Falha ao carregar dados dos funcionários.", "error");
    });

    // --- Setup Notifications Listener ---
    if (unsubscribeNotifications) unsubscribeNotifications(); // Unsubscribe from previous listener if exists

    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3); // Query for notifications from the last 3 days

    // Query sorted by timestamp descending, limited to 50
    const q = query(
        notificacoesCollection,
        where("timestamp", ">=", threeDaysAgo),
        orderBy("timestamp", "desc"),
        limit(50)
    );

    unsubscribeNotifications = onSnapshot(q, (querySnapshot) => {
        notificacoes = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderNotifications(); // Update the notification UI
    }, (error) => {
        console.error("Erro ao buscar notificações. Verifique se o índice do Firestore foi criado:", error);
        // Provide guidance if it's likely an index issue (common Firestore error)
        if (error.code === 'failed-precondition') {
             showToast("Falha ao carregar notificações: Índice do Firestore ausente ou sendo criado. Tente recarregar a página em alguns minutos.", "error");
        } else {
            showToast("Falha ao carregar notificações. Verifique o console para detalhes.", "error");
        }
    });

    // --- Finalize App Startup ---
    closeModal(document.getElementById('loginModal')); // Close login modal
    const appContainer = document.getElementById('app-container');
    if (appContainer) appContainer.classList.remove('hidden'); // Show main app container
    updateUIPermissions(); // Apply UI restrictions based on user profile
    // Initial render based on the default tab (usually Gantt)
    switchTab(currentTab); // Ensure the correct tab content is displayed initially
};

import { setupEventListeners } from './eventListeners.js';

    // --- Modal Cancel Buttons ---
    document.querySelectorAll('.btn-cancel').forEach(b => {
        const modal = b.closest('.modal');
        if (modal) {
             b.addEventListener('click', (e) => {
                 if (modal.id === 'infoEtapaModal') { currentInfoEtapaId = null; } // Reset current ID when closing info modal
                 if (modal.id === 'alocacaoModal') { currentAlocacaoEtapaId = null; } // Reset current ID when closing alocacao modal
                 closeModal(modal, true, 'Ação cancelada.'); // Close with confirmation message
             });
        }
    });

     // Specific cancel button for activity log modal (doesn't need confirmation message)
    const activityLogModal = document.getElementById('activityLogModal');
    if (activityLogModal) {
        const cancelBtn = activityLogModal.querySelector('.btn-cancel-log');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', (e) => closeModal(activityLogModal));
        }
    }


    // --- Form Submissions / Saves ---
    document.getElementById('empresaForm').addEventListener('submit', handleEmpresaForm);
    document.getElementById('funcionarioForm').addEventListener('submit', handleFuncionarioForm);
    document.getElementById('comentarioForm').addEventListener('submit', handleComentarioForm);
    document.getElementById('saveObraBtn').addEventListener('click', handleObraForm); // Triggered by button click, not form submit
    document.getElementById('saveAlocacaoBtn').addEventListener('click', saveAlocacao);
    document.getElementById('saveInfoEtapaBtn').addEventListener('click', saveInfoEtapa);
    document.getElementById('saveFechamentoBtn').addEventListener('click', saveFechamento);
    document.getElementById('userForm').addEventListener('submit', handleUserForm);

    // --- Obra Modal: Pedido/Etapa Management ---
    const pedidosContainer = document.getElementById('pedidosContainer');
    if (pedidosContainer) {
        pedidosContainer.addEventListener('click', e => {
            updateTempPedidosFromForm(); // Read current form state into temp array first
            let changed = false; // Flag to check if re-rendering is needed
            const todayStr = new Date().toISOString().split('T')[0]; // Default date for new etapas

            const pedidoEl = e.target.closest('.pedido-form-item');
            if (!pedidoEl) return; // Ignore clicks outside pedido items
            const pedidoId = pedidoEl.dataset.id;
            const pedidoIndex = tempPedidos.findIndex(p => p.id === pedidoId); // Find index for modification/removal
            if (pedidoIndex === -1) return; // Pedido not found in temp data

            const pedido = tempPedidos[pedidoIndex];

            // --- Handle Button Clicks ---
            if (e.target.closest('.remove-pedido-btn')) {
                // Remove the pedido from the temporary array
                tempPedidos.splice(pedidoIndex, 1);
                changed = true;
            } else if (e.target.closest('.add-etapa-btn')) {
                // Add a new etapa to the current pedido
                const newEtapa = {
                    id: `new_${Date.now()}${Math.random()}`, // Generate unique temporary ID
                    nome: '', data_inicio: todayStr, data_fim: todayStr,
                    colaboradores_alocados: [], colaboradores_reserva: [],
                    visualizacaoRH: false // Default new field
                };
                if (!pedido.etapas) pedido.etapas = []; // Initialize etapas array if needed
                pedido.etapas.push(newEtapa);
                changed = true;
            } else if (e.target.closest('.copy-etapa-btn')) {
                // Duplicate an existing etapa
                const etapaEl = e.target.closest('.etapa-item');
                const originalEtapaId = etapaEl.dataset.id;
                const originalEtapaIndex = (pedido.etapas || []).findIndex(et => et.id === originalEtapaId);

                if (originalEtapaIndex !== -1) {
                    const originalEtapa = pedido.etapas[originalEtapaIndex];
                    const newEtapa = JSON.parse(JSON.stringify(originalEtapa)); // Deep copy
                    newEtapa.id = `new_${Date.now()}${Math.random()}`; // New unique ID
                    newEtapa.visualizacaoRH = false; // Reset RH flag

                    // Reset procedure status to 'Pendente' for the copy
                    newEtapa.procedimentos = {};
                    PROCEDIMENTOS_LIST.forEach(p => newEtapa.procedimentos[p.key] = 'Pendente');
                    newEtapa.procedimentos.responsavel = ''; // Clear responsible person

                    // Offset dates: Start the day after the original ends
                    const duration = diffInDays(originalEtapa.data_inicio, originalEtapa.data_fim);
                    newEtapa.data_inicio = addDays(originalEtapa.data_fim, 1); // Start next day
                    newEtapa.data_fim = addDays(newEtapa.data_inicio, duration); // Maintain duration

                    // Insert the new etapa immediately after the original one
                    pedido.etapas.splice(originalEtapaIndex + 1, 0, newEtapa);
                    changed = true;
                }
            } else if (e.target.closest('.remove-etapa-btn')) {
                // Remove an etapa from the current pedido
                const etapaEl = e.target.closest('.etapa-item');
                const etapaId = etapaEl.dataset.id;
                pedido.etapas = (pedido.etapas || []).filter(e => e.id !== etapaId);
                changed = true;
            }

            // Re-render the pedidos/etapas form if any changes occurred
            if (changed) renderPedidosForm();
        });
    }

    const addPedidoBtn = document.getElementById('addPedidoBtn');
     if (addPedidoBtn) {
        addPedidoBtn.addEventListener('click', () => {
            updateTempPedidosFromForm(); // Read current state first
            // Add a new empty pedido object
            const newPedido = {
                id: `new_${Date.now()}${Math.random()}`, // Temporary unique ID
                numero: '', etapas: []
            };
            tempPedidos.push(newPedido);
            renderPedidosForm(); // Re-render the form
        });
     }


    // --- Gantt Chart Interactions ---
    const ganttWrapper = document.getElementById('ganttChartWrapper');
    if (ganttWrapper) {
        ganttWrapper.addEventListener('click', e => {
            if (ganttDragInfo.isDragging) { return; } // Ignore clicks that are part of a drag operation

            const bar = e.target.closest('.gantt-bar');
            if (bar) {
                // --- Handle Clicks on Gantt Bars ---
                if (copyModeState.active) {
                    // --- In Copy Mode ---
                    if (bar.classList.contains('copy-targetable')) {
                        const targetEtapaId = bar.dataset.targetEtapaId;
                        const [targetObra, targetPedido, targetEtapa] = findEtapaParents(targetEtapaId);
                        const [,, sourceEtapa] = findEtapaParents(copyModeState.sourceEtapaId);

                        if (targetEtapa && sourceEtapa) {
                             const message = `Copiar ${copyModeState.colaboradoresToCopy.length} alocado(s) da etapa "${sourceEtapa.nome}" (${sourceEtapa.data_inicio}) para a etapa "${targetEtapa.nome}" (${targetEtapa.data_inicio})? Os colaboradores existentes na etapa de destino serão mantidos.`;
                             // Show confirmation modal before copying
                             showConfirmModal('Confirmar Cópia de Alocados', message, async () => {
                                const obraToUpdate = obras.find(o => o.id === targetObra.id);
                                const updatedPedidos = JSON.parse(JSON.stringify(obraToUpdate.pedidos)); // Deep copy
                                const pedidoToUpdate = updatedPedidos.find(p => p.id === targetPedido.id);
                                const etapaToUpdate = (pedidoToUpdate.etapas || []).find(e => e.id === targetEtapaId);

                                // Merge existing alocados with the copied ones using a Set to avoid duplicates
                                const combined = new Set([...(etapaToUpdate.colaboradores_alocados || []), ...copyModeState.colaboradoresToCopy]);
                                etapaToUpdate.colaboradores_alocados = Array.from(combined);
                                etapaToUpdate.visualizacaoRH = false; // Reset RH flag on modification

                                try {
                                    await updateDoc(doc(obrasCollection, obraToUpdate.id), { pedidos: updatedPedidos });
                                    showToast("Colaboradores copiados com sucesso!");
                                    logInteraction('copy_allocations_success', { from: copyModeState.sourceEtapaId, to: targetEtapaId });
                                    // Log the copy action
                                    const sourceIdentifier = getEtapaLogIdentifier(findEtapaParents(copyModeState.sourceEtapaId)[1], copyModeState.sourceEtapaId);
                                    const targetIdentifier = getEtapaLogIdentifier(pedidoToUpdate, targetEtapaId);
                                    await logActivity(targetObra.id, `copiou alocados da etapa ${sourceIdentifier} para a etapa ${targetIdentifier}.`);

                                } catch (err) {
                                    showToast("Erro ao copiar colaboradores.", "error");
                                    console.error(err);
                                } finally {
                                    exitCopyMode(); // Exit copy mode regardless of success/failure
                                }
                             });
                        }
                    }
                    return; // Don't open modal in copy mode
                }
                // --- Normal Click on Bar ---
                const etapaId = bar.dataset.etapaId;
                // Open alocacao modal only for individual etapa bars (not summary bars)
                if(etapaId && bar.classList.contains('resizable')) {
                     openAlocacaoModal(etapaId);
                }
                return; // Stop further processing if a bar was clicked
            }

            // --- Handle Clicks on Sidebar Icons/Buttons ---
            const expandBtn = e.target.closest('.expand-btn');
            if (expandBtn) {
                // Toggle expanded/collapsed state for the obra/pedido
                const id = expandBtn.dataset.id;
                ganttExpandedState[id] = ganttExpandedState[id] === false; // Toggle boolean state
                saveUserPreferences(); // Save the new state
                renderGanttChart(); // Re-render the Gantt
                return;
            }
            const fechamentoBtn = e.target.closest('.fechamento-btn');
            if(fechamentoBtn) {
                // Open the fechamento/pendencias modal for the obra
                const id = fechamentoBtn.dataset.id;
                openFechamentoModal(id);
                return;
            }
            const editObraTrigger = e.target.closest('.edit-obra-trigger');
            if(editObraTrigger) {
                // Open the obra modal for editing
                const id = editObraTrigger.dataset.id;
                const obra = obras.find(o => o.id === id);
                if (obra) openObraModal(obra);
                return;
            }
            const rhPendencyBtn = e.target.closest('.rh-pendency-btn');
            if (rhPendencyBtn) {
                // Open the info modal focused on the next pending RH procedure
                const groupRow = rhPendencyBtn.closest('.gantt-row');
                const firstEtapaId = groupRow.dataset.id; // ID stored is the first etapa in the group
                const [, pedido, etapa] = findEtapaParents(firstEtapaId);
                if (etapa && pedido) {
                    // Find all etapas in the group
                    const group = (pedido.etapas || []).filter(e => e.nome === etapa.nome).sort((a, b) => new Date(a.data_inicio) - new Date(b.data_inicio));
                    // Find etapas that still have pending procedures
                    const pendingEtapas = group.filter(e => !PROCEDIMENTOS_LIST.every(p => e.procedimentos && e.procedimentos[p.key] === 'OK'));
                    if (pendingEtapas.length > 0) {
                        const todayStr = new Date().toISOString().split('T')[0];
                        // Try to find the *next* pending etapa starting from today
                        const nextPendingEtapa = pendingEtapas.find(e => e.data_inicio >= todayStr) || pendingEtapas[0]; // Fallback to the first pending one
                        openInfoEtapaModal(nextPendingEtapa.id);
                    } else {
                        // If somehow the icon was clicked but no pendencies found, open the first one
                        openInfoEtapaModal(firstEtapaId);
                    }
                }
                return;
            }

            // --- Handle Clicks on Sidebar Etapa Group Rows ---
            const etapaGroupRow = e.target.closest('.gantt-row[data-type="etapa-group"]');
            if (etapaGroupRow) {
                // Open the alocacao modal for the first etapa in that group
                const firstEtapaIdInGroup = etapaGroupRow.dataset.id;
                openAlocacaoModal(firstEtapaIdInGroup);
                return;
            }
        });
    }

    // --- Colaborador View Interactions (Currently Minimal) ---
     const colabWrapper = document.getElementById('colaboradorGanttWrapper');
     if (colabWrapper) {
        colabWrapper.addEventListener('click', e => {
            const sidebarRow = e.target.closest('.gantt-row');
            if (!sidebarRow) return;
            // Potentially add actions here later, e.g., view employee details
        });
     }


    // --- Gerenciamento Tab: Empresa/Funcionario List Interactions ---
    const empresaList = document.getElementById('empresaList');
    if (empresaList) {
        empresaList.addEventListener('click', e => {
            const item = e.target.closest('.empresa-item');
            if(!item) return; // Ignore clicks outside items
            const id = item.dataset.id;
            const empresa = empresas.find(em => em.id === id);
            if (!empresa) return;

            if (e.target.closest('.edit-btn')) {
                // Open modal to edit the clicked empresa
                openEmpresaModal(empresa);
                return;
            }
            if (e.target.closest('.delete-btn')) {
                // Handle deleting the empresa
                if (currentUser.perfil === 'Visualizacao') return; // Check permission
                const funcsCount = funcionarios.filter(f => f.empresa_id === id).length;
                // Prevent deletion if employees are associated
                if (funcsCount > 0) {
                    showToast(`Não é possível excluir "${empresa.nome}", existem ${funcsCount} funcionário(s) associados. Remova ou reatribua os funcionários primeiro.`, 'error');
                    return;
                }
                // Show confirmation before deleting
                showConfirmModal('Excluir Empresa', `Tem certeza que deseja excluir a empresa "${empresa.nome}"?`, async () => {
                     try {
                        await deleteDoc(doc(empresasCollection, id));
                        showToast(`Empresa "${empresa.nome}" excluída.`);
                        if (selectedEmpresaId === id) { // If the deleted company was selected
                            selectedEmpresaId = null; // Deselect it
                            renderFuncionarioList(); // Clear the funcionario list
                        }
                     } catch (err) {
                          console.error("Erro ao excluir empresa:", err);
                          showToast(`Falha ao excluir "${empresa.nome}".`, "error");
                     }

                });
                return;
            }
            // --- Handle Selecting an Empresa ---
            selectedEmpresaId = id; // Set the globally selected company ID
            renderEmpresaList(); // Re-render list to show selection highlight
            renderFuncionarioList(); // Render the employees for the selected company
        });
    }

    const funcionarioList = document.getElementById('funcionarioList');
    if (funcionarioList) {
        funcionarioList.addEventListener('click', e => {
            const item = e.target.closest('.p-3'); // Target the employee item container
            if(!item || !item.dataset.id) return; // Ignore clicks outside items or on header
            const id = item.dataset.id;
            const func = funcionarios.find(f => f.id === id);
            if (!func) return;

            if (e.target.closest('.edit-btn')) {
                // Open modal to edit the clicked funcionario
                openFuncionarioModal(func);
                return;
            }
            if (e.target.closest('.delete-btn')) {
                // Handle deleting the funcionario
                if (currentUser.perfil === 'Visualizacao') return; // Check permission

                // Basic check if employee is allocated anywhere (can be slow for many projects)
                let isAllocated = false;
                for(const obra of obras) {
                    for(const pedido of (obra.pedidos || [])) {
                        for(const etapa of (pedido.etapas || [])) {
                             if ((etapa.colaboradores_alocados || []).includes(id) || (etapa.colaboradores_reserva || []).includes(id)) {
                                isAllocated = true;
                                break;
                             }
                        }
                        if (isAllocated) break;
                    }
                    if (isAllocated) break;
                }

                if (isAllocated) {
                     showToast(`Não é possível excluir "${func.nome}", pois ele está alocado ou reservado em uma ou mais etapas. Remova-o das etapas primeiro.`, 'error');
                     return;
                }

                // Show confirmation before deleting
                showConfirmModal('Excluir Funcionário', `Tem certeza que deseja excluir "${func.nome}"?`, async () => {
                     try {
                        await deleteDoc(doc(funcionariosCollection, id));
                        showToast(`Funcionário "${func.nome}" excluído.`);
                        // List updates via onSnapshot
                     } catch(err) {
                         console.error("Erro ao excluir funcionário:", err);
                         showToast(`Falha ao excluir "${func.nome}".`, "error");
                     }
                });
                return;
            }
        });
    }

    // --- Zoom Controls ---
    const handleZoom = (direction, isColaboradorView) => {
        const wrapperSelector = isColaboradorView ? '#colaboradorGanttContainer' : '#ganttChartContainer';
        const timeline = document.querySelector(`${wrapperSelector} .gantt-timeline`);
        if (!timeline) return;

        // Calculate the day position at the center of the viewport before zooming
        const centerPoint = timeline.scrollLeft + (timeline.clientWidth / 2);
        const dayAtCenter = centerPoint / zoomLevels[zoomLevel]; // Current day width

        // Update zoom level
        if (direction === 'in' && zoomLevel < zoomLevels.length - 1) zoomLevel++;
        else if (direction === 'out' && zoomLevel > 0) zoomLevel--;
        else return; // No change if already at min/max zoom

        // Calculate the new scroll position to keep the center day centered
        const newScrollLeft = (dayAtCenter * zoomLevels[zoomLevel]) - (timeline.clientWidth / 2); // New day width

        // Re-render the appropriate Gantt view with the new zoom and scroll position
        if(isColaboradorView) renderColaboradorView(newScrollLeft);
        else renderGanttChart(null, newScrollLeft);
        saveUserPreferences(); // Save the new zoom level
    };
    document.getElementById('zoomInBtn')?.addEventListener('click', () => handleZoom('in', false));
    document.getElementById('zoomOutBtn')?.addEventListener('click', () => handleZoom('out', false));
    document.getElementById('colaboradorZoomInBtn')?.addEventListener('click', () => handleZoom('in', true));
    document.getElementById('colaboradorZoomOutBtn')?.addEventListener('click', () => handleZoom('out', true));

    // --- Sort Controls ---
    document.getElementById('sortAlocacao')?.addEventListener('change', () => renderAlocacaoLists(false)); // Re-render alocacao lists on sort change
    
    // v11.1: Modificação para "descongelar" a lista e salvar preferência
    document.getElementById('colaboradorSort')?.addEventListener('change', () => { 
        preserveSortOrderOnNextRender = false; // "Descongela"
        renderColaboradorView(); 
        saveUserPreferences(); 
    }); 
    document.getElementById('obraSort')?.addEventListener('change', () => { 
        preserveSortOrderOnNextRender = false; // "Descongela"
        renderGanttChart(); 
        saveUserPreferences(); 
    }); 
    
    document.getElementById('integracaoSort')?.addEventListener('change', renderIntegracoesView); // Re-render integracoes view


     // --- Filter Controls ---
    document.getElementById('alocacaoSearch')?.addEventListener('input', () => renderAlocacaoLists(true)); // Re-render alocacao on search input (pass true)
    // Integration filters in Alocacao modal
    document.getElementById('filtroBRF')?.addEventListener('change', () => renderAlocacaoLists(true));
    document.getElementById('filtroJBS')?.addEventListener('change', () => renderAlocacaoLists(true));
    // Integration filters in Integracoes tab
    document.getElementById('integracaoFiltroBRF')?.addEventListener('change', renderIntegracoesView);
    document.getElementById('integracaoFiltroJBS')?.addEventListener('change', renderIntegracoesView);
    // v11.4: Adiciona listener para o novo filtro de status (Tarefa 1)
    document.getElementById('integracaoFiltroStatus')?.addEventListener('change', renderIntegracoesView);


    // --- Label Toggle Buttons ---
    const toggleLabel = () => {
        obraLabelType = obraLabelType === 'numero' ? 'nome' : 'numero'; // Toggle between 'numero' and 'nome'
        updateObraLabelBtn(); // Update button text
        // Re-render relevant views
        if (currentTab === 'Gantt') renderGanttChart();
        if (currentTab === 'Colaboradores') renderColaboradorView();
        saveUserPreferences(); // Save the preference
    };
    document.getElementById('toggleObraLabelBtn')?.addEventListener('click', toggleLabel);
    document.getElementById('toggleColaboradorLabelBtn')?.addEventListener('click', toggleLabel);

    // --- Debug Log Controls ---
    document.getElementById('toggleLogBtn')?.addEventListener('click', toggleLogging);
    document.getElementById('downloadLogBtn')?.addEventListener('click', downloadLogs);

    // --- Modal Navigation/Actions ---
    document.getElementById('infoFromAlocacaoBtn')?.addEventListener('click', () => {
        // Close alocacao modal and open info modal for the same etapa
        closeModal(document.getElementById('alocacaoModal'));
        setTimeout(() => openInfoEtapaModal(currentAlocacaoEtapaId), 300); // Delay opening slightly for smoother transition
    });
    document.getElementById('generateEtapaReportBtn')?.addEventListener('click', () => {
        if(currentAlocacaoEtapaId) generateEtapaReport(currentAlocacaoEtapaId);
    });
    document.getElementById('generateObraReportBtn')?.addEventListener('click', () => {
         const obraId = document.getElementById('obraId')?.value;
         if(obraId) generateObraReport(obraId);
    });
    document.getElementById('deleteObraBtn')?.addEventListener('click', () => {
         if (currentUser.perfil === 'Visualizacao') return; // Check permission
         const obraId = document.getElementById('obraId')?.value;
         const obra = obras.find(o => o.id === obraId);
         if (obra) {
            // Show confirmation before deleting obra
            showConfirmModal('Excluir Projeto', `Tem certeza que deseja excluir o projeto "${obra.nome}" (${obra.numero})? Todas os pedidos e etapas associados serão perdidos permanentemente. Esta ação não pode ser desfeita.`, async () => {
                try {
                    await deleteDoc(doc(obrasCollection, obraId));
                    closeModal(document.getElementById('obraModal'));
                    showToast(`Projeto "${obra.nome}" excluído.`);
                    logInteraction('delete_obra', { id: obraId, nome: obra.nome });
                    // Data updates via onSnapshot
                } catch(err) {
                    console.error("Erro ao excluir projeto:", err);
                    showToast(`Falha ao excluir "${obra.nome}".`, "error");
                }
            });
         }
    });
    document.getElementById('activityLogBtn')?.addEventListener('click', () => {
         const obraId = document.getElementById('obraId')?.value;
         if(obraId) openActivityLogModal(obraId);
    });
    document.getElementById('pendenciasFromObraModalBtn')?.addEventListener('click', () => {
        // Open fechamento modal from the obra modal context
        const obraId = document.getElementById('obraId')?.value;
        if(obraId) {
            // Close obra modal first? Optional, might be better to keep it open.
            // closeModal(document.getElementById('obraModal'));
            openFechamentoModal(obraId);
        }
    });
    // Button to add new logistics item in Info Etapa modal
    document.getElementById('addLogisticaBtn')?.addEventListener('click', () => {
        const container = document.getElementById('logisticaContainer');
        // Clear placeholder if present
        const placeholder = container?.querySelector('p');
        if(placeholder) placeholder.remove();
        // Add new empty row
        const el = document.createElement('div');
        el.className = 'grid grid-cols-12 gap-2 items-center';
        el.innerHTML = `
            <input type="text" placeholder="Carro" class="logistica-carro col-span-4 p-1 text-sm bg-gray-700 border-gray-600 rounded">
            <input type="text" placeholder="Motorista" class="logistica-motorista col-span-4 p-1 text-sm bg-gray-700 border-gray-600 rounded">
            <input type="datetime-local" class="logistica-saida col-span-3 p-1 text-sm bg-gray-700 border-gray-600 rounded">
            <button type="button" class="remove-logistica-btn action-btn text-red-500 hover:text-red-400"><svg class="h-5 w-5 pointer-events-none" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5 10a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1z" clip-rule="evenodd" /></svg></button>
        `;
        if (container) container.appendChild(el);
    });
    // Event listener for removing logistics items
    document.getElementById('logisticaContainer')?.addEventListener('click', e => {
         const removeBtn = e.target.closest('.remove-logistica-btn');
         if (removeBtn) {
            removeBtn.closest('.grid').remove(); // Remove the parent row
             // Optional: Add back placeholder if list becomes empty
             const container = document.getElementById('logisticaContainer');
             if (container && container.children.length === 0) {
                 container.innerHTML = '<p class="text-xs text-gray-500 text-center py-2">Nenhum veículo adicionado.</p>';
             }
         }
    });

    // --- Login Form ---
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', async e => {
            e.preventDefault();
            const login = document.getElementById('loginUsuario').value.toLowerCase().trim();
            const senha = document.getElementById('loginSenha').value;
            const errorEl = document.getElementById('loginError');
            if(errorEl) errorEl.classList.add('hidden'); // Hide previous errors

            // --- Simple hardcoded admin check (Insecure - Use Firebase Auth!) ---
            if (login === 'admin' && senha === 'BRYant01') {
                currentUser = { id: 'admin_local', nome: 'Administrador', login: 'admin', perfil: 'admin' }; // Use a distinct ID for local admin
                console.log("Admin login successful (local check).");
                await startApp(); // Proceed to start the app
                return;
            }

            // --- Check against users in Firestore ---
            // Ensure `users` array is populated (usually handled by initial onSnapshot)
            if (!users || users.length === 0) {
                 if(errorEl) {
                     errorEl.textContent = 'Erro ao carregar usuários. Tente novamente.';
                     errorEl.classList.remove('hidden');
                 }
                 console.error("Login attempt failed: Users array not populated.");
                 return;
            }

            const userFound = users.find(u => u.login === login && u.senha === senha); // Plain text password check (INSECURE!)
            if (userFound) {
                currentUser = userFound; // Set the globally logged-in user
                console.log(`User login successful: ${currentUser.nome} (${currentUser.perfil})`);
                await startApp(); // Proceed to start the app
            } else {
                 if(errorEl) {
                    errorEl.textContent = 'Usuário ou senha inválidos.';
                    errorEl.classList.remove('hidden');
                 }
                logInteraction('login_failed', { login });
            }
        });
    }
    // --- Fechamento Modal Interactions ---
    const fechamentoModal = document.getElementById('fechamentoModal');
    if (fechamentoModal) {
        // Button to add a new pendencia item
        const addPendenciaBtn = document.getElementById('addPendenciaBtn');
        if (addPendenciaBtn) {
            addPendenciaBtn.addEventListener('click', () => {
                const input = document.getElementById('newPendenciaInput');
                const texto = input ? input.value.trim() : '';
                if(texto) {
                    const list = document.getElementById('pendenciasList');
                    const index = list ? list.children.length : 0; // Use current length as index for new item
                    const pendenciaEl = document.createElement('div');
                    pendenciaEl.className = 'flex items-center justify-between bg-gray-700/50 p-2 rounded';
                    pendenciaEl.innerHTML = `
                        <div class="flex items-center flex-grow mr-2">
                            <input id="pendencia-${index}" type="checkbox" class="h-4 w-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500 pendencia-checkbox flex-shrink-0" data-index="${index}">
                            <label for="pendencia-${index}" class="ml-2 break-words">${texto}</label>
                        </div>
                        <button class="remove-pendencia-btn action-btn text-red-500 flex-shrink-0" data-index="${index}">
                            <svg class="h-5 w-5 pointer-events-none" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5 10a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1z" clip-rule="evenodd"></path></svg>
                        </button>
                    `;
                    if (list) list.appendChild(pendenciaEl);
                    if (input) input.value = ''; // Clear input field
                }
            });
        }

        // Event listener for interactions within the pendencias list (remove or check/uncheck)
        const pendenciasList = document.getElementById('pendenciasList');
        if (pendenciasList) {
            pendenciasList.addEventListener('click', e => {
                const removeBtn = e.target.closest('.remove-pendencia-btn');
                if (removeBtn) {
                    removeBtn.closest('.flex').remove(); // Remove the entire pendencia item
                    // Re-index remaining items if necessary (optional, but good practice if indices are crucial)
                    // ... (re-indexing logic would go here) ...
                    return;
                }
                 const checkbox = e.target.closest('.pendencia-checkbox');
                 if (checkbox) {
                    // Toggle line-through style on the label when checkbox state changes
                    const label = checkbox.nextElementSibling;
                    if (label) {
                        label.classList.toggle('line-through', checkbox.checked);
                        label.classList.toggle('text-gray-500', checkbox.checked);
                    }
                }
            });
        }
    }


    // --- Settings Modal (Admin Only) ---
    document.getElementById('settingsBtn')?.addEventListener('click', openSettingsModal); // Open settings
    document.getElementById('clearUserFormBtn')?.addEventListener('click', clearUserForm); // Clear the user add/edit form
    // Event listener for user list interactions (edit/delete)
    const userListContainer = document.getElementById('userListContainer');
    if (userListContainer) {
        userListContainer.addEventListener('click', e => {
            const editBtn = e.target.closest('.edit-user-btn');
            const deleteBtn = e.target.closest('.delete-user-btn');
            if (editBtn) {
                // Populate form for editing the selected user
                const user = users.find(u => u.id === editBtn.dataset.id);
                if (user) {
                    document.getElementById('userFormTitle').textContent = `Editando: ${user.nome}`;
                    document.getElementById('userId').value = user.id;
                    document.getElementById('userNome').value = user.nome;
                    document.getElementById('userLogin').value = user.login;
                    document.getElementById('userPerfil').value = user.perfil;
                    document.getElementById('userSenha').value = ''; // Clear password field
                    document.getElementById('userSenha').required = false; // Password not required for editing
                    document.getElementById('userSenha').placeholder = 'Deixe em branco para não alterar';
                }
            } else if(deleteBtn) {
                // Handle deleting the selected user
                const user = users.find(u => u.id === deleteBtn.dataset.id);
                if(user) {
                    // Prevent admin from deleting themselves
                    if (user.id === currentUser?.id) {
                        showToast("Não é possível excluir o próprio usuário.", "error");
                        return;
                    }
                     // Show confirmation before deleting user
                    showConfirmModal("Excluir Usuário", `Tem certeza que deseja excluir o usuário ${user.nome} (${user.login})?`, async () => {
                         try {
                            await deleteDoc(doc(usersCollection, user.id));
                            showToast("Usuário excluído.");
                            clearUserForm(); // Reset form if the deleted user was being edited
                            logInteraction('delete_user', { id: user.id, nome: user.nome });
                            // List updates via onSnapshot
                         } catch(err) {
                              console.error("Erro ao excluir usuário:", err);
                              showToast("Falha ao excluir usuário.", "error");
                         }
                    });
                }
            }
        });
    }

    // --- Copy Mode Buttons ---
    document.getElementById('copyAllocationsBtn')?.addEventListener('click', () => {
        if(currentAlocacaoEtapaId) enterCopyMode(currentAlocacaoEtapaId);
    });
    document.getElementById('cancelCopyModeBtn')?.addEventListener('click', exitCopyMode);

    // --- Info Etapa Modal Navigator ---
    document.getElementById('infoEtapaNavPrev')?.addEventListener('click', () => {
        const { group, index } = currentInfoEtapaGroupContext;
        if (group && index > 0) openInfoEtapaModal(group[index - 1].id); // Open previous etapa in group
    });
    document.getElementById('infoEtapaNavNext')?.addEventListener('click', () => {
        const { group, index } = currentInfoEtapaGroupContext;
        if (group && index < group.length - 1) openInfoEtapaModal(group[index + 1].id); // Open next etapa in group
    });

    // --- Comentarios Interactions (Edit/Delete) ---
     const comentariosContainer = document.getElementById('comentariosContainer');
     if (comentariosContainer) {
        comentariosContainer.addEventListener('click', (e) => {
            const commentItem = e.target.closest('.comment-item');
            if (!commentItem || !commentItem.dataset.index) return; // Ignore clicks outside comment items or if index is missing
            const commentIndex = parseInt(commentItem.dataset.index, 10); // Get original index

            if (e.target.closest('.delete-comment-btn')) {
                handleDeleteComentario(commentIndex); // Trigger delete handler
            } else if (e.target.closest('.edit-comment-btn')) {
                handleEditComentario(commentIndex); // Trigger edit handler
            }
        });
     }

     // --- Gantt Bar Drag & Resize ---
    const ganttChartWrapper = document.getElementById('ganttChartWrapper');
    if (ganttChartWrapper) {
        ganttChartWrapper.addEventListener('mousedown', (e) => {
            // Prevent drag/resize for Visualizacao profile or if in copy mode
            if(currentUser?.perfil === 'Visualizacao' || copyModeState.active) return;
            const bar = e.target.closest('.gantt-bar.resizable'); // Target only resizable bars (individual etapas)
            if (!bar) return;

            const etapaId = bar.dataset.etapaId;
            const [,,etapa] = findEtapaParents(etapaId);
            if(!etapa) return; // Exit if etapa data not found

            // Determine drag type based on where the mousedown occurred
            let dragType;
            if (e.target.classList.contains('gantt-bar-handle-left')) dragType = 'resize-left';
            else if (e.target.classList.contains('gantt-bar-handle-right')) dragType = 'resize-right';
            else dragType = 'drag'; // Default to dragging the whole bar

            // Change cursor style based on drag type
            document.body.style.cursor = (dragType === 'resize-left' || dragType === 'resize-right') ? 'ew-resize' : 'grabbing';

            // Store initial state for drag calculation
            ganttDragInfo = {
                isDragging: false, // Flag set to true only after significant movement
                type: dragType,
                bar: bar,
                id: etapa.id,
                initialX: e.clientX,
                initialLeft: bar.offsetLeft,
                initialWidth: bar.offsetWidth,
                initialStartDate: etapa.data_inicio,
                initialEndDate: etapa.data_fim
            };

            // Add global listeners for mouse move and mouse up
            window.addEventListener('mousemove', handleGanttMouseMove);
            window.addEventListener('mouseup', handleGanttMouseUp);
        });
    }


    // --- Global Search ---
     const globalSearchInput = document.getElementById('globalSearchInput');
     if (globalSearchInput) {
        // Use 'input' event for real-time filtering as user types
        globalSearchInput.addEventListener('input', handleGlobalSearch);
     }


    // --- Notifications ---
    const notificationsBtn = document.getElementById('notificationsBtn');
    if (notificationsBtn) {
        notificationsBtn.addEventListener('click', toggleNotificationMenu);
    }
    // Listener for clicking on a notification item to mark as read and potentially navigate
    const notificationMenu = document.getElementById('notificationMenu');
    if (notificationMenu) {
        notificationMenu.addEventListener('click', async (e) => {
            const item = e.target.closest('.notification-item');
            if (!item || !currentUser) return; // Ensure item and user exist

            const obraId = item.dataset.obraId;
            const notificationId = item.dataset.notificationId;

            // --- Mark as read in Firestore ---
            // Find the notification in the local array first
            const notification = notificacoes.find(n => n.id === notificationId);
            if (notification && (!notification.readBy || !notification.readBy.includes(currentUser.id))) {
                 // Update Firestore only if it wasn't already marked as read by this user
                 const notifRef = doc(notificacoesCollection, notificationId);
                 try {
                     await updateDoc(notifRef, {
                         readBy: arrayUnion(currentUser.id) // Add current user's ID to the readBy array
                     });
                     // Optimistically update UI immediately (or rely on onSnapshot)
                     item.classList.remove('bg-blue-900/30'); // Remove unread highlight
                     // Badge update happens via onSnapshot automatically
                     logInteraction('mark_notification_read', { id: notificationId });
                 } catch (error) {
                      console.error("Erro ao marcar notificação como lida:", error);
                      // Optionally show error to user
                 }
            } else {
                 // Already read, just remove highlight if needed (might happen if UI update was slow)
                 item.classList.remove('bg-blue-900/30');
            }


            // --- Navigation ---
            // Ensure the related obra is visible in the Gantt chart
            if (!activeProjectIds.includes(obraId)) {
                activeProjectIds.push(obraId); // Add temporarily if archived
                // Persist the change so it stays visible
                await setDoc(doc(settingsCollection, 'activeProjects'), { ids: activeProjectIds });
            }
            // Switch to Gantt tab (onSnapshot listener for obras will handle the re-render)
            if (currentTab !== 'Gantt') {
                switchTab('Gantt');
            } else {
                // If already on Gantt, potentially scroll to the project (more complex)
                // For now, just ensuring it's visible is sufficient.
            }

            // Close the notification menu
            if (notificationMenu.style.display === 'block') {
                 toggleNotificationMenu();
            }
        });
    }

     // --- RH Confirmation Button (Alocacao Modal) ---
    document.getElementById('confirmVisualizacaoBtn')?.addEventListener('click', handleConfirmVisualizacao);


}; // --- END of setupEventListeners ---

const handleGanttMouseMove = (e) => {
    if (!ganttDragInfo || !ganttDragInfo.type) return; // Exit if not dragging
    e.preventDefault(); // Prevent text selection during drag

    const deltaX = e.clientX - ganttDragInfo.initialX;
    // Set isDragging flag only after moving a minimum distance (e.g., 5 pixels)
    // This distinguishes a drag from a simple click
    if (!ganttDragInfo.isDragging && Math.abs(deltaX) > 5) {
        ganttDragInfo.isDragging = true;
    }

    if(!ganttDragInfo.isDragging) return; // Don't update UI until dragging actually starts

    const dayWidth = zoomLevels[zoomLevel];
    const deltaDays = Math.round(deltaX / dayWidth); // Calculate change in days

    // --- Update Bar Position/Width Visually based on Drag Type ---
    if (ganttDragInfo.type === 'drag') {
        // Move the entire bar
        const newLeft = ganttDragInfo.initialLeft + (deltaDays * dayWidth);
        ganttDragInfo.bar.style.left = `${Math.max(0, newLeft)}px`; // Prevent negative left position
    } else if (ganttDragInfo.type === 'resize-right') {
        // Resize by changing width (right handle)
        const newWidth = Math.max(dayWidth, ganttDragInfo.initialWidth + (deltaDays * dayWidth)); // Ensure minimum width of one day
        ganttDragInfo.bar.style.width = `${newWidth}px`;
    } else if (ganttDragInfo.type === 'resize-left') {
        // Resize by changing left position and width (left handle)
        const newLeft = ganttDragInfo.initialLeft + (deltaDays * dayWidth);
        const newWidth = ganttDragInfo.initialWidth - (deltaDays * dayWidth);
        // Apply changes only if the new width is valid (at least one day)
        if(newWidth >= dayWidth) {
            ganttDragInfo.bar.style.left = `${Math.max(0, newLeft)}px`;
            ganttDragInfo.bar.style.width = `${newWidth}px`;
        }
    }
};

const handleGanttMouseUp = async (e) => {
    if (!ganttDragInfo || !ganttDragInfo.type) return; // Exit if not dragging

    // --- Cleanup ---
    document.body.style.cursor = 'default'; // Restore default cursor
    // Remove global listeners
    window.removeEventListener('mousemove', handleGanttMouseMove);
    window.removeEventListener('mouseup', handleGanttMouseUp);

    // If it wasn't a real drag (just a click), reset info and exit
    if (!ganttDragInfo.isDragging) {
        ganttDragInfo = { isDragging: false };
        // Trigger a click event manually if needed, or handle click logic elsewhere
        // ganttDragInfo.bar.click(); // Example if click needed
        return;
    }

    // --- Calculate Final Changes ---
    const dayWidth = zoomLevels[zoomLevel];
    const deltaX = e.clientX - ganttDragInfo.initialX;
    const deltaDays = Math.round(deltaX / dayWidth); // Final change in days

    const [obra, pedido, etapa] = findEtapaParents(ganttDragInfo.id);
    // If etapa data not found (e.g., deleted during drag), revert UI and exit
    if(!obra || !pedido || !etapa) {
        console.warn("Etapa not found after drag, reverting visual change.");
        ganttDragInfo = { isDragging: false };
        renderGanttChart(null, lastKnownScrollLeft); // Re-render to reset bar position
        return;
    }

    // --- Determine New Start and End Dates ---
    let newStartDate = etapa.data_inicio;
    let newEndDate = etapa.data_fim;

    if (ganttDragInfo.type === 'drag') {
        newStartDate = addDays(etapa.data_inicio, deltaDays);
        newEndDate = addDays(etapa.data_fim, deltaDays);
    } else if (ganttDragInfo.type === 'resize-right') {
        newEndDate = addDays(etapa.data_fim, deltaDays);
        // Ensure end date doesn't become earlier than start date
        if (new Date(newEndDate) < new Date(etapa.data_inicio)) newEndDate = etapa.data_inicio;
    } else if (ganttDragInfo.type === 'resize-left') {
        newStartDate = addDays(etapa.data_inicio, deltaDays);
         // Ensure start date doesn't become later than end date
        if (new Date(newStartDate) > new Date(etapa.data_fim)) newStartDate = etapa.data_fim;
    }

    // --- Prepare Log Message ---
    const etapaIdentifier = getEtapaLogIdentifier(pedido, etapa.id);
    let logMessage = '';
    const startChanged = newStartDate !== etapa.data_inicio;
    const endChanged = newEndDate !== etapa.data_fim;

    if (startChanged && endChanged) {
        logMessage = `arrastou/redimensionou a etapa ${etapaIdentifier} para ${newStartDate} a ${newEndDate}.`;
    } else if (startChanged) {
         logMessage = `alterou a data inicial da etapa ${etapaIdentifier} para ${newStartDate}.`;
    } else if (endChanged) {
         logMessage = `alterou a data final da etapa ${etapaIdentifier} para ${newEndDate}.`;
    }

    // --- Validate Overlap within the Same Group (Client-Side Check) ---
    const otherEtapasInGroup = (pedido.etapas || []).filter(e => e.nome === etapa.nome && e.id !== etapa.id);
    let hasConflict = false;
    for (const other of otherEtapasInGroup) {
        if (new Date(newStartDate) <= new Date(other.data_fim) && new Date(newEndDate) >= new Date(other.data_inicio)) {
            hasConflict = true;
            break;
        }
    }

    // If overlap detected, show error, revert UI, and exit
    if (hasConflict) {
        showToast('Conflito de datas! A operação sobrepõe outra tarefa na mesma linha.', 'error');
        renderGanttChart(null, lastKnownScrollLeft); // Re-render to reset bar
        ganttDragInfo = { isDragging: false };
        return;
    }

    // --- Save Changes if Dates Changed ---
    if (startChanged || endChanged) {
        // --- Prepare Update Data ---
        const updatedPedidos = JSON.parse(JSON.stringify(obra.pedidos)); // Deep copy
        const pedidoToUpdate = updatedPedidos.find(p => p.id === pedido.id);
        const etapaToUpdate = (pedidoToUpdate?.etapas || []).find(e => e.id === etapa.id);

        if (!etapaToUpdate) { // Safety check
             console.error("Failed to find etapa to update after drag.");
             renderGanttChart(null, lastKnownScrollLeft);
             ganttDragInfo = { isDragging: false };
             return;
        }

        etapaToUpdate.data_inicio = newStartDate;
        etapaToUpdate.data_fim = newEndDate;
        // Reset RH visualization flag if user is not Admin/RH
        if (currentUser.perfil !== 'admin' && currentUser.perfil !== 'RH') {
            etapaToUpdate.visualizacaoRH = false;
        }

        // v11.2: Seta a flag ANTES de salvar no DB para evitar "race condition" com onSnapshot
        preserveSortOrderOnNextRender = true; 

        try {
            // --- Update Firestore ---
            await updateDoc(doc(obrasCollection, obra.id), { pedidos: updatedPedidos });
            // Log the action if a message was prepared
            if (logMessage) {
                await logActivity(obra.id, logMessage);
                if (etapaToUpdate.visualizacaoRH === false && etapa.visualizacaoRH === true) {
                     await logActivity(obra.id, `resetou a confirmação de visualização da etapa ${etapaIdentifier} devido a alteração de data.`);
                }
            }
            showToast("Datas da etapa atualizadas.");
             logInteraction('update_etapa_dates_drag', { id: etapa.id, start: newStartDate, end: newEndDate });
             // No need to manually re-render here, onSnapshot will handle it.
             // Store current scroll position before onSnapshot potentially re-renders
             lastKnownScrollLeft = document.querySelector('#ganttChartContainer .gantt-timeline')?.scrollLeft ?? lastKnownScrollLeft;
        } catch(err) {
            console.error("Erro ao atualizar etapa:", err);
            showToast("Erro ao atualizar datas.", "error");
            preserveSortOrderOnNextRender = false; // v11.2: Reseta a flag em caso de erro no salvamento
            renderGanttChart(null, lastKnownScrollLeft); // Re-render to revert visual change on error
        }
    }
    // Reset drag info state
    ganttDragInfo = { isDragging: false };
}; // --- END of handleGanttMouseUp ---


// --- BUSCA GLOBAL ---
const handleGlobalSearch = () => {
    const searchInput = document.getElementById('globalSearchInput');
    const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';

    // If search term is empty, render the default Gantt view based on active projects
    if (!searchTerm) {
        if(currentTab === 'Gantt') renderGanttChart(); // Render using activeProjectIds
        // No filtering needed for other tabs based on global search
        return;
    }

    // --- Filter Obras based on Search Term ---
    const newExpandedState = {}; // Store IDs to expand based on matches
    const filteredObras = obras.filter(obra => {
        let obraMatch = false; // Does the obra itself match?
        // Check obra name and number
        if (obra.nome.toLowerCase().includes(searchTerm) || obra.numero.toLowerCase().includes(searchTerm)) {
            obraMatch = true;
        }

        // --- Filter Pedidos and Etapas within the Obra ---
        const filteredPedidos = (obra.pedidos || []).map(pedido => {
            let pedidoMatch = false; // Does the pedido itself match?
            // Check pedido number
            if (pedido.numero.toLowerCase().includes(searchTerm)) {
                pedidoMatch = true;
            }

            // --- Filter Etapas within the Pedido ---
            const filteredEtapas = (pedido.etapas || []).filter(etapa => {
                let etapaMatch = false; // Does the etapa itself match?
                // Check etapa name
                if (etapa.nome.toLowerCase().includes(searchTerm)) {
                    etapaMatch = true;
                }

                // Check allocated employees in the etapa
                const alocadosMatch = (etapa.colaboradores_alocados || []).some(funcId => {
                    const func = funcionarios.find(f => f.id === funcId);
                    // Check if employee exists and name matches search term
                    return func && func.nome.toLowerCase().includes(searchTerm);
                });

                if (alocadosMatch) etapaMatch = true; // Match if allocated employee found

                // If etapa matches (name or employee), mark its parents for expansion
                if (etapaMatch) {
                    newExpandedState[obra.id] = true;
                    newExpandedState[pedido.id] = true;
                }
                return etapaMatch; // Keep etapa if it matches
            });

            // If the pedido number matches OR any of its etapas match, keep the pedido
            if (pedidoMatch || filteredEtapas.length > 0) {
                 newExpandedState[obra.id] = true; // Mark obra for expansion
                 // Return the pedido, including only matching etapas if filtering occurred at etapa level
                 // If only pedido number matched, return all original etapas
                 return { ...pedido, etapas: filteredEtapas.length > 0 ? filteredEtapas : pedido.etapas };
            }
            return null; // Discard pedido if neither it nor its children match

        }).filter(Boolean); // Remove null entries (discarded pedidos)

        // Keep the obra if its name/number matched OR any of its children (pedidos/etapas) matched
        if(obraMatch || filteredPedidos.length > 0) {
            // If only obra matched, ensure it's marked for expansion (might be collapsed otherwise)
            if(filteredPedidos.length === 0) newExpandedState[obra.id] = true;
             // Return the obra, including only matching filtered pedidos, or all original pedidos if only obra matched
            return { ...obra, pedidos: filteredPedidos.length > 0 ? filteredPedidos : obra.pedidos };
        }
        return false; // Discard obra if nothing matched
    });

    // Apply the new expanded state derived from search matches
    ganttExpandedState = newExpandedState;
    // Switch to Gantt tab if not already there, and render with filtered results
    if(currentTab !== 'Gantt') switchTab('Gantt'); // This will call renderGanttChart via switchTab
    else renderGanttChart(filteredObras); // Pass the filtered list directly if already on Gantt tab
};

// --- NOTIFICAÇÕES ---
const renderNotifications = () => {
    const menu = document.getElementById('notificationMenu');
    const badge = document.getElementById('notification-badge');
    if (!menu || !badge || !currentUser) return; // Ensure elements and user exist

    // Filter notifications that haven't been read by the current user
    const unread = notificacoes.filter(n => !n.readBy || !n.readBy.includes(currentUser.id));

    // Update badge count
    if (unread.length > 0) {
        badge.textContent = unread.length > 9 ? '9+' : unread.length; // Show count or 9+
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden'); // Hide badge if no unread notifications
    }

    // Render notification items in the dropdown menu
    if (notificacoes.length === 0) {
        menu.innerHTML = `<div class="p-4 text-sm text-gray-400">Nenhuma notificação recente.</div>`;
    } else {
        menu.innerHTML = notificacoes.map(n => {
            const isUnread = unread.some(ur => ur.id === n.id);
            // Format timestamp (handle potential nulls or different types)
            let timeStr = 'Data indisponível';
            if (n.timestamp) {
                const date = n.timestamp.toDate ? n.timestamp.toDate() : (n.timestamp instanceof Date ? n.timestamp : null);
                if (date) timeStr = date.toLocaleString('pt-BR');
            }

            return `
                <div class="p-3 border-b border-gray-700 hover:bg-gray-800 cursor-pointer notification-item ${isUnread ? 'bg-blue-900/30' : ''}" data-obra-id="${n.obraId}" data-notification-id="${n.id}">
                    <p class="text-sm font-semibold">${n.obraNome || 'Projeto Desconhecido'}</p>
                    <p class="text-sm text-gray-300">${n.user || 'Sistema'}: ${n.message || ''}</p>
                    <p class="text-xs text-gray-500 text-right">${timeStr}</p>
                </div>
            `;
        }).join('');
    }
};

// Global listener to close notification menu when clicking outside
const handleOutsideClickForNotifications = (event) => {
    const menu = document.getElementById('notificationMenu');
    const button = document.getElementById('notificationsBtn');

    // If click is inside the button or menu, do nothing
    if (!menu || !button || button.contains(event.target) || menu.contains(event.target)) {
        return;
    }

    // Otherwise, hide the menu and remove the listener
    menu.style.display = 'none';
    document.removeEventListener('click', handleOutsideClickForNotifications, true);
};

const toggleNotificationMenu = async () => {
    if (!currentUser) return; // Don't open if not logged in
    const menu = document.getElementById('notificationMenu');
    if (!menu) return;
    const isVisible = menu.style.display === 'block';

    if (isVisible) {
        // Hide menu and remove outside click listener
        menu.style.display = 'none';
        document.removeEventListener('click', handleOutsideClickForNotifications, true);
    } else {
        // Show menu and add outside click listener
        menu.style.display = 'block';
        document.addEventListener('click', handleOutsideClickForNotifications, true);

        // --- Mark visible notifications as read after a delay ---
        // Get IDs of currently unread notifications
        const unreadIds = notificacoes
            .filter(n => !n.readBy || !n.readBy.includes(currentUser.id))
            .map(n => n.id);

        // Use setTimeout to allow user to see the unread state briefly
        setTimeout(async () => {
            // Only proceed if the menu is still open after the delay
            if (menu.style.display === 'block' && unreadIds.length > 0) {
                console.log(`Marking ${unreadIds.length} notifications as read for user ${currentUser.id}`);
                // Batch update Firestore (more efficient for many updates, but simple loop here)
                for (const id of unreadIds) {
                    const notifRef = doc(notificacoesCollection, id);
                    try {
                        // Add current user's ID to the readBy array
                        await updateDoc(notifRef, {
                            readBy: arrayUnion(currentUser.id)
                        });
                         logInteraction('auto_mark_notification_read', { id });
                    } catch (error) {
                         console.error(`Erro ao marcar notificação ${id} como lida:`, error);
                         // Don't stop marking others if one fails
                    }
                }
                 // Badge count will update automatically via onSnapshot
            }
        }, 2500); // Delay marking as read by 2.5 seconds
    }
};


// --- App Initialization ---
// --- App Initialization ---
// --- App Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    // Set footer text with current year and version
    const footer = document.getElementById('footer-text');
    if (footer) {
        // MODIFICAÇÃO v12.0: Atualiza número da versão no rodapé
        footer.innerHTML = `&copy; ${new Date().getFullYear()} FRINOX | Desenvolvido por Alisson Araújo. Versão 12.1`;
    }
    updateObraLabelBtn(); // Set initial text for label toggle buttons
    setupEventListeners(); // Attach all event listeners
    initialize(); // Initialize Firebase and show login modal
});


// --- v10.5 ---

