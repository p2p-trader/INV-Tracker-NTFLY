export interface InventoryResponse {
  headers: string[];
  rows: (string | number)[][];
}

export interface Transaction {
  postingDate: string;
  quantity: number;
  user: string;
  costCenter: string;
  reservation: string;
  document: string;
  headerText: string;
  text: string;
}

export interface DashboardTransaction extends Transaction {
  type: 'in' | 'out';
}

export interface MaterialSummary {
  material: string;
  materialDescription: string;
  totalIn: number;
  totalOut: number;
  balance: number;
  unit: string;
  inTransactions: Transaction[];
  outTransactions: Transaction[];
}