export interface KnifeSettings {
  cutThrough: boolean;
  xray: boolean;
  angle: number;
  angleMode: number;
  measures: number;
}
export const defaultKnifeSettings: KnifeSettings = {
  cutThrough: false,
  xray: true,
  angle: 30,
  angleMode: 0,
  measures: 0,
};
