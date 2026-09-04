import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Copy, KeyRound, Plus } from "lucide-react";
import { generateApiKey, listApiKeys, revokeApiKey } from "@/lib/api-key-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";

interface ApiKeysPanelProps {
  orgId: string;
}

export function ApiKeysPanel({ orgId }: ApiKeysPanelProps) {
  const queryClient = useQueryClient();
  const queryKey = ["api-keys", orgId];
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const keys = useQuery({
    queryKey,
    queryFn: () => listApiKeys({ data: { orgId } }),
  });

  const generate = useMutation({
    mutationFn: () => generateApiKey({ data: { orgId, name: name.trim() } }),
    onSuccess: (result) => {
      setFormOpen(false);
      setName("");
      setRevealedKey(result.rawKey);
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not create API key"),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => revokeApiKey({ data: { id } }),
    onSuccess: () => {
      toast.success("API key revoked");
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not revoke API key"),
  });

  const copyKey = async () => {
    if (!revealedKey) return;
    await navigator.clipboard.writeText(revealedKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        API keys authenticate requests to the{" "}
        <a href="/api/v1/openapi.json" className="underline" target="_blank" rel="noreferrer">
          public REST API
        </a>{" "}
        (<code>Authorization: Bearer sk_live_...</code>). A key can only do what your role could do
        in the app at the moment it was created — reissue it after a role change to pick up new
        access. The full key is shown once, right after you create it.
      </p>

      {keys.data && keys.data.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.data.map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="font-medium">{k.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {k.key_prefix}…
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDateTime(k.created_at)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {k.last_used_at ? formatDateTime(k.last_used_at) : "Never"}
                  </TableCell>
                  <TableCell>
                    {k.revoked_at ? (
                      <Badge variant="destructive">Revoked</Badge>
                    ) : (
                      <Badge variant="secondary">Active</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {!k.revoked_at ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        disabled={revoke.isPending}
                        onClick={() => revoke.mutate(k.id)}
                      >
                        Revoke
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          No API keys yet.
        </p>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <Plus className="size-4" />
            New API key
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New API key</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              generate.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="api-key-name">Name</Label>
              <Input
                id="api-key-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Zapier integration"
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={generate.isPending || !name.trim()}>
                {generate.isPending ? "Creating…" : "Create key"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!revealedKey} onOpenChange={(v) => !v && setRevealedKey(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="size-4" />
              Your new API key
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-warn">
            Copy this now — for your security, it won't be shown again.
          </p>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
            <code className="min-w-0 flex-1 truncate text-xs">{revealedKey}</code>
            <Button type="button" variant="ghost" size="icon" onClick={() => void copyKey()}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setRevealedKey(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
