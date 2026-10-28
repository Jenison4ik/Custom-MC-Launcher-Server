declare module "png-to-ico" {
  function pngToIco(input: string | Buffer | Array<string | Buffer>): Promise<Buffer>;
  export default pngToIco;
}
