import { ArrowUpRight, Box, Sparkles } from "lucide-react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ASSISTANT_NAME, LOGO_SRC } from "@/features/assistant";

export default function Home() {
  const navigate = useNavigate();

  return (
    <main className="relative min-h-full overflow-hidden bg-background font-sans text-foreground">
      <div className="relative mx-auto grid w-[min(960px,calc(100%_-_80px))] grid-cols-2 gap-x-5 gap-y-7 pt-[clamp(70px,10vh,95px)] pb-[60px] max-[640px]:w-[calc(100%_-_40px)] max-[640px]:grid-cols-[1fr] max-[640px]:gap-y-6 max-[640px]:pt-[68px]">
        <header className="col-span-full">
          <img
            src={LOGO_SRC}
            alt="Movynta"
            draggable={false}
            className="mb-5 h-9 w-auto select-none"
          />
          <h1 className="text-[clamp(24px,3vw,30px)] leading-[1.12] font-bold tracking-[-0.045em]">
            Home
          </h1>
          <p className="mt-[7px] text-[12px] leading-[1.4] text-muted-foreground">
            Your next idea starts here.
          </p>
        </header>
        <Card className="border-0 bg-transparent p-0 text-inherit shadow-none">
          <Button
            type="button"
            variant="ghost"
            className="surface-brand group relative block h-[184px] w-[min(100%,420px)] cursor-pointer overflow-hidden rounded-[14px] border border-brand/30 p-0 text-left whitespace-normal text-foreground shadow-[0_18px_45px_#00000040,inset_0_1px_#ffffff1a] transition-[transform,border-color,box-shadow] duration-[220ms] ease-[ease] hover:-translate-y-[3px] hover:border-brand/60 hover:text-foreground hover:shadow-[0_22px_54px_#00000055,inset_0_1px_#ffffff29] focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring motion-reduce:transition-none"
            onClick={() => void navigate("/studio")}
          >
            <span className="relative z-1 flex h-full flex-col items-start justify-between px-6 py-5">
              <span className="grid size-10 flex-none place-items-center rounded-xl border border-foreground/20 bg-foreground/10 text-foreground">
                <Sparkles size={20} strokeWidth={1.7} />
              </span>
              <span className="flex max-w-[190px] flex-col items-start">
                <span className="text-[18px] leading-[1.2] font-bold tracking-[-0.025em]">
                  AI Design Studio
                </span>
                <span className="mt-[7px] text-[12px] leading-[1.45] text-foreground/80">
                  Create characters and objects in 3D with {ASSISTANT_NAME}.
                </span>
                <span className="mt-2.5 inline-flex items-center gap-[5px] font-[650] text-[11px] text-foreground">
                  Open studio{" "}
                  <ArrowUpRight
                    size={14}
                    className="transition-transform duration-[220ms] ease-[ease] group-hover:translate-x-[2px] group-hover:-translate-y-[2px] motion-reduce:transition-none"
                  />
                </span>
              </span>
            </span>
            <span
              className="pointer-events-none absolute -right-[10px] top-[51%] h-[190px] w-[190px] -translate-y-1/2 opacity-50 max-[760px]:-right-[50px] max-[760px]:opacity-[.35] max-[640px]:-right-[10px] max-[640px]:opacity-[.45]"
              aria-hidden="true"
            >
              <span className="absolute inset-[17px] rounded-full border border-foreground/25" />
              <span className="absolute inset-x-[47px] inset-y-0 rotate-[55deg] rounded-full border border-foreground/25" />
              <span className="absolute top-1/2 left-1/2 grid size-[76px] -translate-x-1/2 -translate-y-1/2 -rotate-12 place-items-center rounded-[22px] border border-foreground/35 bg-foreground/10 text-foreground shadow-[inset_0_1px_#ffffff29,0_14px_32px_#00000030]">
                <Box size={46} strokeWidth={1.1} />
              </span>
              <span className="absolute top-[29px] left-[39px] size-1.5 rounded-full bg-foreground shadow-[0_0_14px_var(--foreground)]" />
            </span>
            <ArrowUpRight
              className="absolute top-5 right-[21px] text-foreground/70"
              size={17}
              aria-hidden="true"
            />
          </Button>
        </Card>
      </div>
    </main>
  );
}
