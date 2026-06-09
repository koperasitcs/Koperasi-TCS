/**
 * Types and interfaces for Penyata Kedudukan Saham 2026.
 */

export interface Member {
  "No. Ahli": string;
  "Nama Penuh": string;
  "No. Kad Pengenalan": string;
}

export interface MemberFinancials {
  digits6: string;
  ic: string;
  name: string;
  saham: number;
  yuran: number;
  terima: number;
  jumlah: number;
}

export interface WebMember {
  memberNo: string;
  fullName: string;
  icNumber: string;
}
