import { obras, conflictMap, funcionarios, empresas, selectedEmpresaId, activeProjectIds, notificacoes, currentUser } from './store.js';
import { PROCEDIMENTOS_LIST } from './store.js';
import { getIntegracaoStatus } from './businessLogic.js';

const renderDashboard = () => {
    const today = new Date();
    today.setHours(0,0,0,0);
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(today.getDate() + 7);

    // Card: Obras em Andamento
    const obrasEmAndamento = obras.filter(obra => {
        if (obra.finalizada) return false; // Exclude finished projects
        // Check if any etapa is currently active
        return (obra.pedidos || []).some(p => (p.etapas || []).some(e => {
            if (!e.data_inicio || !e.data_fim) return false;
            const start = new Date(e.data_inicio + 'T00:00:00');
            const end = new Date(e.data_fim + 'T00:00:00');
            return start <= today && today <= end;
        }));
    }).length;
    document.getElementById('dbObrasAndamento').textContent = obrasEmAndamento;

    // Card: Colaboradores em Conflito
    const conflictedFuncIds = new Set();
    conflictMap.forEach(etapaConflicts => { // Iterate through conflicted etapas
        etapaConflicts.forEach((msg, funcId) => { // Iterate through conflicted employees in each etapa
            conflictedFuncIds.add(funcId);
        });
    });
    document.getElementById('dbColaboradoresConflito').textContent = conflictedFuncIds.size;

    // Card: Pendências de RH
    const totalPendenciasRh = obras.reduce((count, obra) => {
        // Count etapas where not all required procedures are marked 'OK'
        return count + (obra.pedidos || []).flatMap(p => p.etapas || []).filter(e =>
            !PROCEDIMENTOS_LIST.every(proc => e.procedimentos && e.procedimentos[proc.key] === 'OK')
        ).length;
    }, 0);
    document.getElementById('dbPendenciasRh').textContent = totalPendenciasRh;

    // Card: Pendências de Projeto
    const totalPendenciasProjeto = obras.reduce((count, obra) => {
        // Count project-level pendencies that are not marked as completed
        return count + (obra.pendencias || []).filter(p => !p.concluida).length;
    }, 0);
    document.getElementById('dbPendenciasProjeto').textContent = totalPendenciasProjeto;

    // Lista: Etapas Críticas (Próximos 7 dias)
    const proximasEtapasContainer = document.getElementById('dbProximasEtapas');
    const proximasEtapas = [];
    obras.forEach(obra => {
        if (obra.finalizada) return; // Skip finished projects
        (obra.pedidos || []).forEach(pedido => {
            (pedido.etapas || []).forEach(etapa => {
                if (!etapa.data_inicio) return;
                const startDate = new Date(etapa.data_inicio + 'T00:00:00');
                // Check if etapa starts within the next 7 days (including today)
                if (startDate >= today && startDate <= sevenDaysFromNow) {
                    proximasEtapas.push({ ...etapa, obraNome: obra.nome, obraId: obra.id, pedidoNumero: pedido.numero });
                }
            });
        });
    });
    // Sort upcoming etapas by start date
    proximasEtapas.sort((a, b) => new Date(a.data_inicio) - new Date(b.data_inicio));
    // Render the list or a placeholder message
    if (proximasEtapas.length > 0) {
        proximasEtapasContainer.innerHTML = proximasEtapas.map(etapa => `
            <div class="bg-gray-700/50 p-3 rounded-lg">
                <p class="font-semibold text-white">${etapa.nome}</p>
                <p class="text-sm text-gray-400">${etapa.obraNome} - Pedido ${etapa.pedidoNumero}</p>
                <p class="text-sm font-bold text-yellow-400">Início em: ${new Date(etapa.data_inicio + 'T00:00:00').toLocaleDateString('pt-BR')}</p>
            </div>
        `).join('');
    } else {
        proximasEtapasContainer.innerHTML = '<p class="text-gray-500">Nenhuma etapa crítica encontrada.</p>';
    }

    // Lista: Atividades Recentes
    const atividadesRecentesContainer = document.getElementById('dbAtividadesRecentes');
    // Flatten all activity logs from all obras, adding obra context
    const allLogs = obras.flatMap(obra =>
        (obra.activityLog || []).map(log => ({...log, obraNome: obra.nome, obraId: obra.id }))
    ).filter(log => log && log.timestamp); // Ensure log and timestamp exist

    // Sort logs by timestamp (most recent first)
    allLogs.sort((a, b) => {
        // Handle both Firestore Timestamp objects and JS Date objects (from newly added logs)
        const dateA = a.timestamp.toDate ? a.timestamp.toDate() : (a.timestamp instanceof Date ? a.timestamp : new Date(0));
        const dateB = b.timestamp.toDate ? b.timestamp.toDate() : (b.timestamp instanceof Date ? b.timestamp : new Date(0));
        return dateB - dateA;
    });
    // Take the top 15 most recent logs
    const recentLogs = allLogs.slice(0, 15);

    // Render the logs or a placeholder message
    if (recentLogs.length > 0) {
        atividadesRecentesContainer.innerHTML = recentLogs.map(log => {
             const date = log.timestamp.toDate ? log.timestamp.toDate() : (log.timestamp instanceof Date ? log.timestamp : null);
            if (!date || !date.getTime) { // Skip if date is invalid
                return '';
            }
            // Calculate time ago string
            const timeAgo = Math.round((new Date() - date) / (1000 * 60)); // minutes ago
            const timeAgoStr = timeAgo < 1 ? 'agora mesmo' : (timeAgo < 60 ? `${timeAgo} min atrás` : `${Math.floor(timeAgo/60)}h atrás`);
            return `
                <div class="border-l-4 border-gray-600 pl-3">
                    <p class="text-sm text-white"><strong class="font-semibold">${log.user}</strong> ${log.message}</p>
                    <p class="text-xs text-gray-400">${log.obraNome} - <span class="text-gray-500">${timeAgoStr}</span></p>
                </div>
            `;
        }).join('');
    } else {
        atividadesRecentesContainer.innerHTML = '<p class="text-gray-500">Nenhuma atividade recente.</p>';
    }
};

const renderEmpresaList = () => {
    const container = document.getElementById('empresaList');
    container.innerHTML = '';
    // Sort empresas, ensuring "FRINOX EQUIPAMENTOS INDUSTRIAIS" is always first
    const sortedEmpresas = [...empresas].sort((a, b) => {
        // --- MODIFICAÇÃO (Hard-coded) ---
        if (a.nome === 'FRINOX EQUIPAMENTOS INDUSTRIAIS' && b.nome !== 'FRINOX EQUIPAMENTOS INDUSTRIAIS') return -1;
        if (a.nome !== 'FRINOX EQUIPAMENTOS INDUSTRIAIS' && b.nome === 'FRINOX EQUIPAMENTOS INDUSTRIAIS') return 1;
        // --- FIM DA MODIFICAÇÃO ---
        return a.nome.localeCompare(b.nome); // Alphabetical otherwise
    });
    // Render each empresa item
    sortedEmpresas.forEach(empresa => {
        const selectedClass = empresa.id === selectedEmpresaId ? 'selected' : 'bg-gray-900/50 hover:bg-gray-700/50';
        const el = document.createElement('div');
        el.className = `empresa-item p-3 rounded-lg flex justify-between items-center cursor-pointer transition ${selectedClass}`;
        el.dataset.id = empresa.id;
        el.innerHTML = `<p class="font-semibold text-white pointer-events-none">${empresa.nome}</p>
            <div class="flex items-center gap-2">
                <button data-id="${empresa.id}" class="edit-btn action-btn" title="Editar"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 pointer-events-none" viewBox="0 0 20 20" fill="currentColor"><path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" /><path fill-rule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clip-rule="evenodd" /></svg></button>
                <button data-id="${empresa.id}" class="delete-btn action-btn" title="Excluir"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 pointer-events-none" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V8z" clip-rule="evenodd" /></svg></button>
            </div>`;
        container.appendChild(el);
    });
};

const renderFuncionarioList = () => {
    const container = document.getElementById('funcionarioList');
    container.innerHTML = '';
    const addBtn = document.getElementById('addFuncionarioBtn');
    const title = document.getElementById('funcionariosTitle');

    // Se não há empresa selecionada, exibe placeholder e desativa botão de adicionar
    if (!selectedEmpresaId) {
        container.innerHTML = '<p class="text-sm text-gray-500">Selecione uma empresa para ver os funcionários.</p>';
        addBtn.disabled = true;
        title.textContent = 'Funcionários';
        return;
    }
    const empresa = empresas.find(e => e.id === selectedEmpresaId);
    addBtn.disabled = false;
    title.textContent = `Funcionários de ${empresa.nome}`;

    // Filtra funcionários da empresa selecionada
    const funcs = funcionarios.filter(f => f.empresa_id === selectedEmpresaId);
    if (funcs.length === 0) {
        container.innerHTML = '<p class="text-sm text-gray-500">Nenhum funcionário cadastrado.</p>'; return;
    }

    // v10.9 - Funções auxiliares para data e cor (corrigido)
    const formatDate = (dateStr) => {
        if (!dateStr) return 'N/A';
        const parts = dateStr.split('-');
        if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
        return dateStr;
    };

    const getColorClass = (status) => {
        if (status === 'em_dia') return 'data-verde';
        if (status === 'vencendo') return 'data-amarela';
        if (status === 'vencida') return 'data-vermelha';
        return 'data-cinza'; // N/A ou Sem integração
    };

    // Ordena e renderiza a lista
    funcs.sort((a, b) => a.nome.localeCompare(b.nome)).forEach(func => {
        const el = document.createElement('div');
        // v10.9: O card em si é flex (para alinhar botões à direita)
        el.className = 'p-3 bg-gray-900/50 rounded-lg flex justify-between items-center';
        el.dataset.id = func.id;

        // v10.9: Pega status e formata datas/cores
        const intStatus = getIntegracaoStatus(func);
        const brfColorClass = getColorClass(intStatus.brf.status);
        const jbsColorClass = getColorClass(intStatus.jbs.status);
        const brfDate = formatDate(intStatus.brf.data_validade);
        const jbsDate = formatDate(intStatus.jbs.data_validade);

        // v10.9 (CORRIGIDO): Layout (Nome - Cargo) na Linha 1, Datas (coloridas) na Linha 2
        el.innerHTML = `
            <div class="flex-grow truncate mr-4">
                <p class="text-sm font-semibold text-white truncate" title="${func.nome} ${func.cargo ? `- ${func.cargo}` : ''}">
                    ${func.nome}
                    <span class="text-gray-400 font-normal">${func.cargo ? `- ${func.cargo}` : ''}</span>
                </p>
                <div class="text-xs mt-1 space-x-4">
                    <span class="${brfColorClass}" title="BRF: ${brfDate}">BRF: ${brfDate}</span>
                    <span class="${jbsColorClass}" title="JBS: ${jbsDate}">JBS: ${jbsDate}</span>
                </div>
            </div>
            <div class="flex items-center gap-2 flex-shrink-0">
                <button data-id="${func.id}" class="edit-btn action-btn" title="Editar"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 pointer-events-none" viewBox="0 0 20 20" fill="currentColor"><path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" /><path fill-rule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clip-rule="evenodd" /></svg></button>
                <button data-id="${func.id}" class="delete-btn action-btn" title="Excluir"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 pointer-events-none" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V8z" clip-rule="evenodd" /></svg></button>
            </div>`;
        container.appendChild(el);
    });
};

const renderGerenciamentoView = () => {
    const activeContainer = document.getElementById('activeProjectsList');
    const archivedContainer = document.getElementById('archivedProjectsList');
    activeContainer.innerHTML = '';
    archivedContainer.innerHTML = '';

    // Populate active and archived lists based on `activeProjectIds`
    obras.forEach(obra => {
        const card = document.createElement('div');
        card.className = 'project-card';
        card.dataset.id = obra.id;
        card.innerHTML = `<p class="font-semibold text-sm">${obra.nome}</p><p class="text-xs text-gray-400">Nº: ${obra.numero}</p>`;

        if(activeProjectIds.includes(obra.id)) {
            activeContainer.appendChild(card);
        } else {
            archivedContainer.appendChild(card);
        }
    });

    // Function to save the updated list of active projects
    const onUpdateProjects = async () => {
        const newActiveIds = Array.from(activeContainer.children).map(child => child.dataset.id);
        activeProjectIds = newActiveIds; // Update global variable
        // Save the new list to Firestore
        await setDoc(doc(settingsCollection, 'activeProjects'), { ids: newActiveIds });
        showToast("Lista de projetos ativos atualizada.");
        logInteraction('update_active_projects', { count: newActiveIds.length });
        // Optional: Re-render Gantt if the user might be viewing it
        // if (currentTab === 'Gantt') renderGanttChart();
    };

    // Destroy existing Sortable instances
    activeProjectsSortables.forEach(s => s.destroy());
    activeProjectsSortables = [];
    // Initialize SortableJS for both lists, allowing dragging between them
    activeProjectsSortables.push(new Sortable(activeContainer, { group: 'projects', animation: 150, onEnd: onUpdateProjects }));
    activeProjectsSortables.push(new Sortable(archivedContainer, { group: 'projects', animation: 150, onEnd: onUpdateProjects }));
};

const renderIntegracoesView = () => {
    const container = document.getElementById('integracoesListContainer');
    container.innerHTML = ''; // Clear previous content
    container.classList.remove('space-y-1.5'); // v10.9: Remove spacing from container (added to lists)

    // v11.4: Lê os novos filtros
    const filtroStatus = document.getElementById('integracaoFiltroStatus').value;
    const filtroBRF = document.getElementById('integracaoFiltroBRF').checked;
    const filtroJBS = document.getElementById('integracaoFiltroJBS').checked;
    const sortType = document.getElementById('integracaoSort').value;

    let filteredFuncionarios = [...funcionarios];

    // v11.4: Aplicar filtro de STATUS (Tarefa 1)
    if (filtroStatus !== 'todos') {
        filteredFuncionarios = filteredFuncionarios.filter(func => {
            const status = getIntegracaoStatus(func);
            const brfStatus = status.brf.status;
            const jbsStatus = status.jbs.status;

            // Lógica para checar se o funcionário bate com o filtro
            if (filtroStatus === 'em_dia') {
                return brfStatus === 'em_dia' || jbsStatus === 'em_dia';
            }
            if (filtroStatus === 'vencendo') {
                // Deve estar vencendo E não pode estar vencido (vencido tem prioridade)
                const vencendo = brfStatus === 'vencendo' || jbsStatus === 'vencendo';
                const vencido = brfStatus === 'vencida' || jbsStatus === 'vencida';
                return vencendo && !vencido;
            }
            if (filtroStatus === 'vencida') {
                return brfStatus === 'vencida' || jbsStatus === 'vencida';
            }
            if (filtroStatus === 'sem_integracao') {
                return brfStatus === 'sem_integracao' && jbsStatus === 'sem_integracao';
            }
            return true; // Nunca deve cair aqui se filtroStatus !== 'todos'
        });
    }

    // Apply integration filters (BRF/JBS)
    if (filtroBRF || filtroJBS) {
        filteredFuncionarios = filteredFuncionarios.filter(func => {
            const status = getIntegracaoStatus(func);
            const hasBRF = status.brf.status !== 'sem_integracao';
            const hasJBS = status.jbs.status !== 'sem_integracao';
            if (filtroBRF && filtroJBS) return hasBRF && hasJBS;
            if (filtroBRF) return hasBRF;
            if (filtroJBS) return hasJBS;
            return false; // Should not happen if one is checked
        });
    }

    // Define sort priority function for integration status
    const getStatusPriority = (func) => {
        const status = getIntegracaoStatus(func);
        const brfStatus = status.brf.status;
        const jbsStatus = status.jbs.status;

        // v10.9: Prioridade: 1=em_dia, 2=vencendo, 3=vencida, 4=sem_integracao
        if (brfStatus === 'vencida' || jbsStatus === 'vencida') return 3; // v11.4: Vencida (3) vem antes de Sem Integração (4)
        if (brfStatus === 'vencendo' || jbsStatus === 'vencendo') return 2;
        if (brfStatus === 'em_dia' || jbsStatus === 'em_dia') return 1;
        return 4;
    };

    // Apply primary sorting (by Status) and secondary sorting (Empresa/Nome)
    filteredFuncionarios.sort((a, b) => {
        const priorityA = getStatusPriority(a);
        const priorityB = getStatusPriority(b);
        // v11.4: A ordenação por status (prioridade) é a PRIMÁRIA
        if (priorityA !== priorityB) return priorityA - priorityB; // Sort by status first

        // Secondary sort based on user selection
        if (sortType === 'empresa') {
            const empresaA = empresas.find(e => e.id === a.empresa_id);
            const empresaB = empresas.find(e => e.id === b.empresa_id);
            const nomeEmpresaA = empresaA ? empresaA.nome : 'ZZZ'; // Put 'Sem Empresa' last
            const nomeEmpresaB = empresaB ? empresaB.nome : 'ZZZ';

            // --- MODIFICAÇÃO (Hard-coded) ---
            if (nomeEmpresaA === 'FRINOX EQUIPAMENTOS INDUSTRIAIS' && nomeEmpresaB !== 'FRINOX EQUIPAMENTOS INDUSTRIAIS') return -1;
            if (nomeEmpresaA !== 'FRINOX EQUIPAMENTOS INDUSTRIAIS' && nomeEmpresaB === 'FRINOX EQUIPAMENTOS INDUSTRIAIS') return 1;
            // --- FIM DA MODIFICAÇÃO ---

            if (nomeEmpresaA !== nomeEmpresaB) return nomeEmpresaA.localeCompare(nomeEmpresaB); // Sort by company name
        }
        // If same status and (same company or sorting by name), sort by employee name
        return a.nome.localeCompare(b.nome);
    });

    // --- Render List ---
    let statsVencendo = 0;
    let statsEmDia = 0;
    let statsVencida = 0; // v10.9: Adicionado contador
    let statsSemIntegracao = 0; // v11.4: Adicionado

    const renderGroup = (funcsToRender, parentElement, isGrouped = false) => {
        funcsToRender.forEach(func => {
            const status = getIntegracaoStatus(func);

            // v11.4: Atualiza contadores (lógica refinada)
            const brfStatus = status.brf.status;
            const jbsStatus = status.jbs.status;

            if (brfStatus === 'vencida' || jbsStatus === 'vencida') {
                statsVencida++;
            } else if (brfStatus === 'vencendo' || jbsStatus === 'vencendo') {
                statsVencendo++;
            } else if (brfStatus === 'em_dia' || jbsStatus === 'em_dia') {
                statsEmDia++;
            } else if (brfStatus === 'sem_integracao' && jbsStatus === 'sem_integracao') {
                statsSemIntegracao++;
            }


            const el = document.createElement('div');
            // v10.9: Removido bgColorClass, padding aumentado
            el.className = `colaborador-card !p-3`;
            el.dataset.id = func.id;

            // v10.9: Lógica para formatar datas e cores
            const formatDate = (dateStr) => {
                if (!dateStr) return 'N/A';
                const parts = dateStr.split('-');
                if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
                return dateStr;
            };

            const getColorClass = (status) => {
                if (status === 'em_dia') return 'data-verde';
                if (status === 'vencendo') return 'data-amarela';
                if (status === 'vencida') return 'data-vermelha';
                return 'data-cinza';
            };

            const brfColorClass = getColorClass(status.brf.status);
            const jbsColorClass = getColorClass(status.jbs.status);
            const brfDate = formatDate(status.brf.data_validade);
            const jbsDate = formatDate(status.jbs.data_validade);

            let brfText = `BRF: ${brfDate}`;
            if (status.brf.status === 'vencendo' && status.brf.dias_restantes !== null) {
                brfText += ` (${status.brf.dias_restantes}d)`;
            }
             let jbsText = `JBS: ${jbsDate}`;
            if (status.jbs.status === 'vencendo' && status.jbs.dias_restantes !== null) {
                jbsText += ` (${status.jbs.dias_restantes}d)`;
            }

            // v10.9: Layout atualizado (Nome - Cargo) e datas empilhadas
            el.innerHTML = `
                <div class="colaborador-info" title="${func.nome} - ${func.cargo || 'N/A'}">
                    <strong class="nome text-sm">${func.nome}</strong>
                    ${func.cargo ? `<span class="cargo text-xs text-gray-400"> - ${func.cargo}</span>` : ''}
                    ${!isGrouped ? `<span class="text-xs text-gray-500 ml-2">(${empresas.find(e => e.id === func.empresa_id)?.nome || 'Sem Empresa'})</span>` : ''}
                </div>
                <div class="integracao-datas">
                    <p class="${brfColorClass}" title="${brfText}">${brfText}</p>
                    <p class="${jbsColorClass}" title="${jbsText}">${jbsText}</p>
                </div>`;
            parentElement.appendChild(el);
        });
    };

    if (sortType === 'empresa') {
        const grouped = filteredFuncionarios.reduce((acc, func) => {
            const empresaId = func.empresa_id || 'sem_empresa';
            if (!acc[empresaId]) acc[empresaId] = [];
            acc[empresaId].push(func);
            return acc;
        }, {});

        const sortedEmpresaIds = Object.keys(grouped).sort((a, b) => {
            const empresaA = empresas.find(e => e.id === a);
            const empresaB = empresas.find(e => e.id === b);
            const nomeA = empresaA ? empresaA.nome : 'ZZZ';
            const nomeB = empresaB ? empresaB.nome : 'ZZZ';

            // --- MODIFICAÇÃO (Hard-coded) ---
            if (nomeA === 'FRINOX EQUIPAMENTOS INDUSTRIAIS' && nomeB !== 'FRINOX EQUIPAMENTOS INDUSTRIAIS') return -1;
            if (nomeA !== 'FRINOX EQUIPAMENTOS INDUSTRIAIS' && nomeB === 'FRINOX EQUIPAMENTOS INDUSTRIAIS') return 1;
            // --- FIM DA MODIFICAÇÃO ---

            return nomeA.localeCompare(nomeB);
        });

        sortedEmpresaIds.forEach(empresaId => {
            const empresaNome = (empresas.find(e => e.id === empresaId) || {nome: 'Sem Empresa'}).nome;
            const groupContainer = document.createElement('div');
            groupContainer.className = 'empresa-group !p-3 !mb-4';
            const listEl = document.createElement('div');
            listEl.className = 'space-y-1.5'; // v10.9: Adiciona espaço entre os cards
            groupContainer.innerHTML = `<h4 class="font-semibold text-blue-300 mb-2">${empresaNome}</h4>`;

            renderGroup(grouped[empresaId], listEl, true); // true = is grouped by company

            groupContainer.appendChild(listEl);
            container.appendChild(groupContainer);
        });

    } else { // Sort by name
        renderGroup(filteredFuncionarios, container, false); // false = not grouped by company
        container.classList.add('space-y-1.5'); // v10.9: Adiciona espaço entre os cards
    }

    // Update stats
    // v11.4: Atualiza estatísticas totais (independente do filtro de status, mas dependente dos filtros BRF/JBS)
    // Recalcula estatísticas com base na lista *antes* do filtro de status, mas *depois* do filtro BRF/JBS
    let statsTotalVencida = 0;
    let statsTotalVencendo = 0;
    let statsTotalEmDia = 0;

    // Lista para estatísticas: aplica apenas filtros BRF/JBS
    let statsFuncionarios = [...funcionarios];
    if (filtroBRF || filtroJBS) {
        statsFuncionarios = statsFuncionarios.filter(func => {
            const status = getIntegracaoStatus(func);
            const hasBRF = status.brf.status !== 'sem_integracao';
            const hasJBS = status.jbs.status !== 'sem_integracao';
            if (filtroBRF && filtroJBS) return hasBRF && hasJBS;
            if (filtroBRF) return hasBRF;
            if (filtroJBS) return hasJBS;
            return false;
        });
    }

    statsFuncionarios.forEach(func => {
        const status = getIntegracaoStatus(func);
        const brfStatus = status.brf.status;
        const jbsStatus = status.jbs.status;

        if (brfStatus === 'vencida' || jbsStatus === 'vencida') {
            statsTotalVencida++;
        } else if (brfStatus === 'vencendo' || jbsStatus === 'vencendo') {
            statsTotalVencendo++;
        } else if (brfStatus === 'em_dia' || jbsStatus === 'em_dia') {
            statsTotalEmDia++;
        }
    });

    document.getElementById('integracaoStatsVencendo').textContent = statsTotalVencendo;
    document.getElementById('integracaoStatsEmDia').textContent = statsTotalEmDia;
    document.getElementById('integracaoStatsVencida').textContent = statsTotalVencida;

     if (filteredFuncionarios.length === 0) {
        container.innerHTML = '<p class="text-sm text-gray-500 text-center py-4">Nenhum colaborador encontrado com os filtros selecionados.</p>';
    }

};

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

export { renderDashboard, renderEmpresaList, renderFuncionarioList, renderGerenciamentoView, renderIntegracoesView, renderNotifications };
