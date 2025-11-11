import { funcionarios, conflictMap, colaboradorEtapasMap } from './store.js';
import { diffInDays } from './utils.js';

const getIntegracaoStatus = (func) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(today.getDate() + 30);

    const checkStatus = (validadeDateStr) => {
        if (!validadeDateStr) {
            return { status: 'sem_integracao', dias_restantes: null, data_validade: null };
        }

        const validadeDate = new Date(validadeDateStr + 'T00:00:00');

        if (isNaN(validadeDate.getTime())) {
             return { status: 'sem_integracao', dias_restantes: null, data_validade: validadeDateStr };
        }

        const diffDays = diffInDays(today.toISOString().split('T')[0], validadeDateStr);

        // v10.8: Adicionada verificação de VENCIDA
        if (validadeDate < today) {
            return { status: 'vencida', dias_restantes: diffDays, data_validade: validadeDateStr };
        }

        if (validadeDate <= thirtyDaysFromNow) {
            return { status: 'vencendo', dias_restantes: diffDays, data_validade: validadeDateStr };
        } else {
            return { status: 'em_dia', dias_restantes: diffDays, data_validade: validadeDateStr };
        }
    };

    return {
        brf: checkStatus(func.integracaoBRF),
        jbs: checkStatus(func.integracaoJBS)
    };
};

const calculateAllConflicts = () => {
    if (funcionarios.length === 0) return;
    conflictMap.clear();
    updateColaboradorEtapasMap(); // Make sure the map is up-to-date

    colaboradorEtapasMap.forEach((etapas, funcId) => {
        // Sort etapas chronologically for the current employee
        const sortedEtapas = [...etapas].sort((a, b) => new Date(a.data_inicio) - new Date(b.data_inicio));

        // Compare each pair of tasks for overlaps
        for (let i = 0; i < sortedEtapas.length; i++) {
            for (let j = i + 1; j < sortedEtapas.length; j++) {
                const e1 = sortedEtapas[i];
                const e2 = sortedEtapas[j];
                // Skip if dates are invalid
                if (!e1.data_inicio || !e1.data_fim || !e2.data_inicio || !e2.data_fim) continue;

                const start1 = new Date(e1.data_inicio);
                const end1 = new Date(e1.data_fim);
                const start2 = new Date(e2.data_inicio);
                const end2 = new Date(e2.data_fim);

                // Check for overlap: (StartA <= EndB) and (StartB <= EndA)
                if (start1 <= end2 && start2 <= end1) {
                    const func = funcionarios.find(f => f.id === funcId);
                    const funcName = func ? func.nome : `ID Desconhecido`;

                    // Create conflict messages
                    const conflictInfo1 = `Conflito de ${funcName} com: ${e2.obraNome} (Pedido ${e2.pedidoNumero}) - Etapa "${e2.nome}"`;
                    const conflictInfo2 = `Conflito de ${funcName} com: ${e1.obraNome} (Pedido ${e1.pedidoNumero}) - Etapa "${e1.nome}"`;

                    // Store conflict info in the map, keyed by etapa ID, then func ID
                    if (!conflictMap.has(e1.id)) conflictMap.set(e1.id, new Map());
                    conflictMap.get(e1.id).set(funcId, conflictInfo1);

                    if (!conflictMap.has(e2.id)) conflictMap.set(e2.id, new Map());
                    conflictMap.get(e2.id).set(funcId, conflictInfo2);
                }
            }
        }
    });
};

const getObraSortPriority = (obra, today) => {
    let earliestStartDate = null;
    let isActive = false;

    const etapas = (obra.pedidos || []).flatMap(p => p.etapas || []);
    if (etapas.length === 0) {
        // Obra without tasks gets lowest priority, far future date
        return { priority: 3, date: new Date('2999-12-31') };
    }

    for (const etapa of etapas) {
        if (!etapa.data_inicio) continue; // Skip etapas without start date
        const startDate = new Date(etapa.data_inicio + 'T00:00:00');
        const endDate = new Date((etapa.data_fim || etapa.data_inicio) + 'T00:00:00'); // Use start date if end date is missing

        // Check if the task is currently active
        if (startDate <= today && today <= endDate) {
            isActive = true;
            // Update earliest start date if this active task starts earlier
            if (!earliestStartDate || startDate < earliestStartDate) {
                earliestStartDate = startDate;
            }
        } else if (startDate > today) { // Check if the task is in the future
            // Update earliest start date if this future task starts earlier
            if (!earliestStartDate || startDate < earliestStartDate) {
                earliestStartDate = startDate;
            }
        }
        // Past tasks are ignored for determining the 'earliestStartDate' unless they make the project active
    }

    // Determine priority based on status
    if (isActive) return { priority: 1, date: earliestStartDate || today }; // Active projects first
    if (earliestStartDate) return { priority: 2, date: earliestStartDate }; // Future projects second
    return { priority: 3, date: new Date('2999-12-31') }; // Completed or past projects last
};

const getEarliestTaskDateForEmployee = (funcId, today) => {
    const tasks = colaboradorEtapasMap.get(funcId) || [];
    if (tasks.length === 0) return { priority: 3, date: new Date('2999-12-31') }; // Employee with no tasks gets lowest priority

    let earliestStartDate = null;
    let isActive = false;

    for (const task of tasks) {
        const startDate = new Date(task.data_inicio + 'T00:00:00');
        const endDate = new Date(task.data_fim + 'T00:00:00');
        // Check if the employee is currently active in this task
        if (startDate <= today && today <= endDate) {
            isActive = true;
             // Update earliest start date if this active task starts earlier
            if (!earliestStartDate || startDate < earliestStartDate) {
                earliestStartDate = startDate;
            }
        } else if (startDate > today) { // Check if the task is in the future
             // Update earliest start date if this future task starts earlier
            if (!earliestStartDate || startDate < earliestStartDate) {
                earliestStartDate = startDate;
            }
        }
    }

    // Determine priority based on activity status
    if (isActive) return { priority: 1, date: earliestStartDate || today }; // Active employees first
    if (earliestStartDate) return { priority: 2, date: earliestStartDate }; // Employees with future tasks second
    return { priority: 3, date: new Date('2999-12-31') }; // Employees with only past tasks last
};

const mergeDateRanges = (etapas) => {
    if (!etapas || etapas.length === 0) return [];

    // v11.4: Filtrar, mapear para objetos com datas e status, e ordenar
    const sorted = [...etapas]
        .filter(e => e.data_inicio && e.data_fim)
        .map(e => ({
            start: new Date(e.data_inicio + 'T00:00:00'),
            end: new Date(e.data_fim + 'T00:00:00'),
            // v11.4: Rastreia o status da visualização. 'false' (azul) tem prioridade.
            visualizacaoRH: e.visualizacaoRH
        }))
        .sort((a, b) => a.start - b.start);

    if (sorted.length === 0) return [];

    const merged = [];
    let currentMerge = { ...sorted[0] };

    for (let i = 1; i < sorted.length; i++) {
        const nextEtapa = sorted[i];

        // Verifica se a próxima tarefa começa no dia seguinte ou antes do término da atual
        if (nextEtapa.start <= new Date(currentMerge.end.getTime() + 86400000)) { // Adiciona um dia em milissegundos
            // Estende a data final se a próxima tarefa terminar depois
            if (nextEtapa.end > currentMerge.end) {
                currentMerge.end = nextEtapa.end;
            }
            // v11.4: Lógica de prioridade da cor
            // Se a barra atual ('currentMerge') for verde (true/undefined) E a próxima for azul (false),
            // a barra inteira se torna azul (false).
            if (currentMerge.visualizacaoRH !== false && nextEtapa.visualizacaoRH === false) {
                currentMerge.visualizacaoRH = false;
            }
        } else {
            // Gap encontrado, finaliza a barra atual e inicia uma nova
            merged.push({
                data_inicio: currentMerge.start.toISOString().split('T')[0],
                data_fim: currentMerge.end.toISOString().split('T')[0],
                visualizacaoRH: currentMerge.visualizacaoRH // v11.4: Salva o status da barra
            });
            currentMerge = { ...nextEtapa };
        }
    }

    // Adiciona a última barra mesclada
    merged.push({
        data_inicio: currentMerge.start.toISOString().split('T')[0],
        data_fim: currentMerge.end.toISOString().split('T')[0],
        visualizacaoRH: currentMerge.visualizacaoRH // v11.4: Salva o status da barra
    });

    return merged;
};

export { getIntegracaoStatus, calculateAllConflicts, getObraSortPriority, getEarliestTaskDateForEmployee, mergeDateRanges };
