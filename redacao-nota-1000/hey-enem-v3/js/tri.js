import { EXAM_CONFIG } from './examConfig.js';

// Fórmula da planilha fornecida pelo usuário.
// Não é a TRI oficial do ENEM; é a transformação matemática existente
// nas células AZ das abas M1, M2, N1 e N2.
export function calculateSpreadsheetTRI(F,M,D){
  const value=400 + 900 * Math.pow((F + 1.5*M + 1.75*D)/90,1.14);
  return Number.isFinite(value)?value:null;
}

export function explainTRI(F,M,D){
  return {
    formula:EXAM_CONFIG.spreadsheetFormula.tri,
    components:{F,M,D},
    weighted:F + 1.5*M + 1.75*D,
    denominator:90
  };
}
