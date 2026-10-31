import { useState, type FormEvent } from "react";
import { ArrowLeft, ArrowUp } from "lucide-react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function Assistant() {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState("");
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (prompt.trim()) setSubmitted(true);
  }

  return (
    <main className="flex min-h-screen flex-col bg-[#191919] px-5 py-24 font-sans text-[#ededed]">
      <Button type="button" variant="ghost" className="absolute top-10 left-[44px] z-20 h-9 cursor-pointer gap-2 border-0 bg-transparent p-0 text-[13px] text-[#b8b7bf] hover:bg-transparent hover:text-white focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-[5px] focus-visible:outline-[#b4a0ff]" onClick={() => void navigate("/")}><ArrowLeft size={16} /> Home</Button>

      <section className="relative m-auto w-full max-w-[620px] text-center" aria-labelledby="home-heading">
        <div className="mb-[38px] max-[600px]:mb-7">
          <h1 id="home-heading" className="text-[clamp(24px,3vw,29px)] leading-[1.2] font-[750] tracking-[-1.2px]">What do you want to design?</h1>
          <p className="mt-1.5 text-[13px] leading-[1.5] text-[#b9b9b9]">Describe a character or an object and watch it take shape in 3D.</p>
        </div>
        <Card className="gap-0 rounded-full border-[#383838] bg-[#292929] p-0 text-inherit shadow-[0_8px_26px_#00000020] focus-within:border-[#77706d]">
          <form className="flex min-h-[58px] items-center gap-3 py-2 pr-[9px] pl-5" onSubmit={handleSubmit}>
            <label className="sr-only" htmlFor="design-prompt">Describe your design</label>
            <Input id="design-prompt" className="h-auto min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 py-0 text-[14px] text-[#f1f1f1] shadow-none outline-0 placeholder:text-[#a5a5a5] focus-visible:ring-0 md:text-[14px]" value={prompt} onChange={(event) => { setPrompt(event.target.value); setSubmitted(false); }} placeholder="A friendly robot with a glowing orange antenna..." autoComplete="off" />
            <Button size="icon" className="grid size-[39px] flex-none cursor-pointer place-items-center rounded-full border-0 bg-[#ed805f] p-0 text-[#28201d] hover:bg-[#f49375] focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[#ed805f] disabled:cursor-default disabled:opacity-[.8]" type="submit" aria-label="Submit design prompt" disabled={!prompt.trim()}><ArrowUp size={20} strokeWidth={1.8} /></Button>
          </form>
        </Card>
        {submitted && <output className="absolute inset-x-0 top-[calc(100%+18px)] text-[12px] text-[#aaa]">Design generation is coming soon.</output>}
      </section>
    </main>
  );
}

