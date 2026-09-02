import { Instagram, Linkedin, Link2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

// WhatsApp icon isn't in lucide's core set; a small inline glyph keeps this
// dependency-free instead of pulling in a whole brand-icon package for one
// icon.
function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
      <path d="M12.001 2C6.478 2 2 6.478 2 12c0 1.85.505 3.58 1.383 5.065L2 22l5.065-1.383A9.94 9.94 0 0 0 12 22c5.523 0 10-4.478 10-10S17.523 2 12.001 2zm0 18.09a8.07 8.07 0 0 1-4.126-1.128l-.296-.176-3.06.836.827-3.011-.192-.309A8.09 8.09 0 1 1 20.09 12a8.09 8.09 0 0 1-8.089 8.09z" />
    </svg>
  );
}

async function copyLink(url: string, message: string) {
  try {
    await navigator.clipboard.writeText(url);
    toast.success(message);
  } catch {
    toast.error("Couldn't copy the link — copy it from the address bar instead.");
  }
}

export function ShareButtons({
  url,
  title,
  className,
}: {
  url: string;
  title: string;
  className?: string;
}) {
  const handleLinkedIn = () => {
    const shareUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
    window.open(shareUrl, "_blank", "noopener,noreferrer,width=600,height=600");
  };

  const handleWhatsApp = () => {
    const text = `${title}\n${url}`;
    const shareUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(shareUrl, "_blank", "noopener,noreferrer");
  };

  // Instagram has no public web share intent for an arbitrary URL the way
  // WhatsApp/LinkedIn do. The honest options are the OS share sheet (which
  // lists Instagram as one of its targets on supporting devices) or, failing
  // that, a copied link the person pastes into their bio/story/DM
  // themselves — never a link that silently does nothing.
  const handleInstagram = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
      } catch {
        // User cancelled the share sheet — not an error worth surfacing.
      }
      return;
    }
    await copyLink(url, "Link copied — paste it into your Instagram bio, story or DM.");
  };

  return (
    <div className={className}>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Share this article
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={handleLinkedIn}>
          <Linkedin className="size-4" />
          LinkedIn
        </Button>
        <Button variant="outline" size="sm" onClick={handleWhatsApp}>
          <WhatsAppIcon className="size-4" />
          WhatsApp
        </Button>
        <Button variant="outline" size="sm" onClick={handleInstagram}>
          <Instagram className="size-4" />
          Instagram
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => copyLink(url, "Link copied to clipboard.")}
        >
          <Link2 className="size-4" />
          Copy link
        </Button>
      </div>
    </div>
  );
}
