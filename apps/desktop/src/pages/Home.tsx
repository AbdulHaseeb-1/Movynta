import { ArrowUpRight, Box, Sparkles } from "lucide-react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function Home() {
  const navigate = useNavigate();

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#19191c] bg-[radial-gradient(ellipse_at_70%_5%,#34273570,transparent_42%)] font-sans text-[#f3f2f6]">
      <div className="relative mx-auto grid w-[min(960px,calc(100%_-_80px))] grid-cols-2 gap-x-5 gap-y-7 pt-[clamp(70px,10vh,95px)] pb-[60px] max-[640px]:w-[calc(100%_-_40px)] max-[640px]:grid-cols-[1fr] max-[640px]:gap-y-6 max-[640px]:pt-[68px]">
        <header className="col-span-full">
          <h1 className="text-[clamp(24px,3vw,30px)] leading-[1.12] font-bold tracking-[-0.045em]">Home</h1>
          <p className="mt-[7px] text-[12px] leading-[1.4] text-[#b4b2ba]">Your next idea starts here.</p>
        </header>
        <Card className="border-0 bg-transparent p-0 text-inherit shadow-none">
          <Button
            type="button"
            variant="ghost"
            className="group relative block h-[184px] w-[min(100%,420px)] cursor-pointer overflow-hidden rounded-[14px] border border-[#ffffff24] bg-[radial-gradient(circle_at_88%_0%,#f19e8250,transparent_48%),linear-gradient(120deg,#302939_0%,#68405d_55%,#b35e62_115%)] p-0 text-left whitespace-normal text-white shadow-[0_18px_45px_#08080c38,inset_0_1px_#ffffff1a] transition-[transform,border-color,box-shadow] duration-[220ms] ease-[ease] hover:-translate-y-[3px] hover:border-[#ffc8b47a] hover:bg-transparent hover:bg-[radial-gradient(circle_at_88%_0%,#f9ae905c,transparent_48%),linear-gradient(120deg,#392d40_0%,#79496b_55%,#c96d6e_115%)] hover:text-white hover:shadow-[0_22px_54px_#08080c50,inset_0_1px_#ffffff29] focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#ffc1b1] motion-reduce:transition-none"
            onClick={() => void navigate("/studio")}
          >
            <span className="relative z-1 flex h-full flex-col items-start justify-between px-6 py-5">
              <span className="grid size-10 flex-none place-items-center rounded-xl border border-[#ffd9d044] bg-[#ffd3c51c] text-[#ffded5]"><Sparkles size={20} strokeWidth={1.7} /></span>
              <span className="flex max-w-[190px] flex-col items-start">
                <span className="text-[18px] leading-[1.2] font-bold tracking-[-0.025em]">AI Design Studio</span>
                <span className="mt-[7px] text-[12px] leading-[1.45] text-[#f4e1e1]">Create characters and objects in 3D.</span>
                <span className="mt-2.5 inline-flex items-center gap-[5px] font-[650] text-[11px] text-[#ffe5db]">
                  Open studio <ArrowUpRight size={14} className="transition-transform duration-[220ms] ease-[ease] group-hover:translate-x-[2px] group-hover:-translate-y-[2px] motion-reduce:transition-none" />
                </span>
              </span>
            </span>
            <span className="pointer-events-none absolute -right-[10px] top-[51%] h-[190px] w-[190px] -translate-y-1/2 opacity-50 max-[760px]:-right-[50px] max-[760px]:opacity-[.35] max-[640px]:-right-[10px] max-[640px]:opacity-[.45]" aria-hidden="true">
              <span className="absolute inset-[17px] rounded-full border border-[#ffe0d14a]" />
              <span className="absolute inset-x-[47px] inset-y-0 rotate-[55deg] rounded-full border border-[#ffe0d14a]" />
              <span className="absolute top-1/2 left-1/2 grid size-[76px] -translate-x-1/2 -translate-y-1/2 -rotate-12 place-items-center rounded-[22px] border border-[#ffe4d566] bg-[linear-gradient(145deg,#ffe3d12a,#ffb2a00a)] text-[#ffe3d4] shadow-[inset_0_1px_#ffffff29,0_14px_32px_#2c152323]"><Box size={46} strokeWidth={1.1} /></span>
              <span className="absolute top-[29px] left-[39px] size-1.5 rounded-full bg-[#ffd0a8] shadow-[0_0_14px_#ffd0a8]" />
            </span>
            <ArrowUpRight className="absolute top-5 right-[21px] text-[#ffffffb3]" size={17} aria-hidden="true" />
          </Button>
        </Card>
      </div>
    </main>
  );
}
