import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import AnimatedFileUpload from "@/components/smoothui/animated-file-upload";
import AnimatedStepper, { type StepItem } from "@/components/smoothui/animated-stepper";
import Skeleton from "@/components/smoothui/skeleton-loader";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";

type LauncherInfo = { version: string | null; yml: string | null };

type LauncherSettings = {
  apiUrl: string;
  productName: string;
  appId: string;
  version: string;
  theme: Record<string, string>;
  hasIcon: boolean;
  iconDataUrl: string | null;
};

type BuildStatus = {
  status: "idle" | "running" | "success" | "failed";
  startedAt: string | null;
  finishedAt: string | null;
  commit: string | null;
  version: string | null;
  error: string | null;
  log: string;
};

const DEFAULT_PRODUCT_NAME = "Custom Minecraft Launcher";
const lastStep = 3;

const THEME_FIELDS = [
  { token: "--color-bg", label: "Фон", fallback: "#0c0d10" },
  { token: "--color-surface", label: "Поверхность", fallback: "#16181d" },
  { token: "--color-text", label: "Текст", fallback: "#f2f4f7" },
  { token: "--color-muted", label: "Подписи", fallback: "#9399a6" },
  { token: "--color-accent", label: "Акцент", fallback: "#3dce8a" },
  { token: "--color-accent-deep", label: "Акцент, тёмный", fallback: "#14915a" },
  { token: "--color-accent-hover", label: "Акцент при наведении", fallback: "#67dba4" },
  { token: "--color-launch-text", label: "Текст на кнопке запуска", fallback: "#062014" },
] as const;

const STATUS_LABEL: Record<BuildStatus["status"], string> = {
  idle: "Сборка ещё не запускалась",
  running: "Идёт сборка…",
  success: "Сборка опубликована",
  failed: "Сборка не удалась",
};

function compareSemver(left: string, right: string): number | null {
  const parse = (value: string) => {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
    if (!match) return null;
    return match.slice(1).map((part) => Number(part));
  };
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function pickerValue(value: string, fallback: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

export function LauncherPage() {
  const queryClient = useQueryClient();
  const info = useQuery({
    queryKey: ["launcher"],
    queryFn: () => api<LauncherInfo>("/admin/launcher"),
  });
  const settings = useQuery({
    queryKey: ["launcher-settings"],
    queryFn: () => api<LauncherSettings>("/admin/launcher/settings"),
  });
  const build = useQuery({
    queryKey: ["launcher-build"],
    queryFn: () => api<BuildStatus>("/admin/launcher/build"),
    refetchInterval: (query) => (query.state.data?.status === "running" ? 2000 : false),
  });

  const [apiUrl, setApiUrl] = useState("");
  const [productName, setProductName] = useState(DEFAULT_PRODUCT_NAME);
  const [appId, setAppId] = useState("ru.jenison.cml");
  const [version, setVersion] = useState("");
  const [theme, setTheme] = useState<Record<string, string>>({});
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [uploadVersion, setUploadVersion] = useState("");
  const [yml, setYml] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploadKey, setUploadKey] = useState(0);
  const [step, setStep] = useState(0);
  const [loaded, setLoaded] = useState<LauncherInfo | null>(null);

  useEffect(() => {
    if (!settings.data) return;
    setApiUrl(settings.data.apiUrl);
    setProductName(settings.data.productName);
    setAppId(settings.data.appId);
    setVersion(settings.data.version);
    setTheme(
      Object.fromEntries(
        THEME_FIELDS.map((field) => [field.token, settings.data?.theme[field.token] || field.fallback])
      )
    );
    setIconPreview((current) => {
      if (current?.startsWith("blob:")) URL.revokeObjectURL(current);
      return settings.data?.iconDataUrl ?? null;
    });
  }, [settings.data]);

  if (info.data && info.data !== loaded) {
    setLoaded(info.data);
    setUploadVersion(info.data.version ?? "");
    setYml(info.data.yml ?? "");
  }

  useEffect(() => {
    if (build.data?.status !== "success") return;
    void queryClient.invalidateQueries({ queryKey: ["launcher"] });
  }, [build.data?.status, build.data?.finishedAt, queryClient]);

  function settingsBody() {
    return JSON.stringify({
      apiUrl,
      productName,
      appId,
      version,
      theme: Object.fromEntries(THEME_FIELDS.map((field) => [field.token, theme[field.token] || field.fallback])),
    });
  }

  const save = useMutation({
    mutationFn: () => api("/admin/launcher/settings", { method: "PUT", body: settingsBody() }),
    onSuccess: async () => {
      toast.success("Настройки сохранены");
      await queryClient.invalidateQueries({ queryKey: ["launcher-settings"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const iconUpload = useMutation({
    mutationFn: (icon: File) => {
      const body = new FormData();
      body.set("file", icon);
      return api("/admin/launcher/icon", { method: "PUT", body });
    },
    onSuccess: () => toast.success("Иконка сохранена"),
    onError: (error: Error) => toast.error(error.message),
  });

  const startBuild = useMutation({
    mutationFn: async () => {
      await api("/admin/launcher/settings", { method: "PUT", body: settingsBody() });
      return api("/admin/launcher/build", { method: "POST" });
    },
    onSuccess: async () => {
      toast.success("Сборка запущена");
      await queryClient.invalidateQueries({ queryKey: ["launcher-settings"] });
      await queryClient.invalidateQueries({ queryKey: ["launcher-build"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Выберите ZIP установщика");
      const body = new FormData();
      body.set("file", file);
      body.set("yml", yml.trim());
      return api("/admin/launcher", {
        method: "POST",
        headers: { version: uploadVersion.trim() },
        body,
      });
    },
    onSuccess: async () => {
      toast.success("Лаунчер обновлён");
      setFile(null);
      setUploadKey((value) => value + 1);
      setStep(0);
      await info.refetch();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const published = info.data?.version ?? null;
  const versionDelta = version.trim() && published ? compareSemver(version.trim(), published) : null;
  const building = build.data?.status === "running" || startBuild.isPending;
  const versionReady = uploadVersion.trim().length > 0;
  const fileReady = file !== null;
  const ymlReady = yml.trim().length > 0;
  const canGoNext =
    (step === 0 && versionReady) || (step === 1 && fileReady) || (step === 2 && ymlReady);

  function onSave(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (step < lastStep) {
      if (canGoNext) setStep((current) => current + 1);
      return;
    }
    upload.mutate();
  }

  function onIcon(fileList: FileList | null) {
    const icon = fileList?.[0];
    if (!icon) return;
    const preview = URL.createObjectURL(icon);
    setIconPreview((current) => {
      if (current?.startsWith("blob:")) URL.revokeObjectURL(current);
      return preview;
    });
    iconUpload.mutate(icon);
  }

  const steps: StepItem[] = [
    {
      label: "Версия",
      content: (
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="launcher-version">Версия</FieldLabel>
            <Input
              id="launcher-version"
              value={uploadVersion}
              onChange={(event) => setUploadVersion(event.target.value)}
            />
            <FieldDescription>Номер версии, который уйдёт в version.json.</FieldDescription>
          </Field>
          <StepActions nextDisabled={!versionReady} onNext={() => setStep(1)} />
        </FieldGroup>
      ),
    },
    {
      label: "Архив",
      content: (
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="launcher-zip">ZIP</FieldLabel>
            <AnimatedFileUpload
              key={uploadKey}
              accept=".zip,application/zip"
              dropLabel="Отпустите архив"
              hint="ZIP установщика"
              idleLabel="Перетащите ZIP или нажмите, чтобы выбрать"
              inputId="launcher-zip"
              inputLabel="ZIP"
              multiple={false}
              onFilesSelected={(files) => setFile(files[0] ?? null)}
            />
            <FieldDescription>Архив установщика. На сервер уходит только .zip.</FieldDescription>
          </Field>
          <StepActions nextDisabled={!fileReady} onBack={() => setStep(0)} onNext={() => setStep(2)} />
        </FieldGroup>
      ),
    },
    {
      label: "latest.yml",
      content: (
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="launcher-yml">latest.yml</FieldLabel>
            <Textarea id="launcher-yml" rows={12} value={yml} onChange={(event) => setYml(event.target.value)} />
            <FieldDescription>Содержимое файла обновления electron-updater.</FieldDescription>
          </Field>
          <StepActions nextDisabled={!ymlReady} onBack={() => setStep(1)} onNext={() => setStep(3)} />
        </FieldGroup>
      ),
    },
    {
      label: "Публикация",
      content: (
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Проверка</CardTitle>
              <CardDescription>Эти данные уйдут на сервер.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="flex flex-col gap-3 text-sm">
                <div className="flex flex-col gap-1">
                  <dt className="text-muted-foreground">Версия</dt>
                  <dd>{uploadVersion.trim()}</dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-muted-foreground">Архив</dt>
                  <dd className="truncate">{file?.name}</dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-muted-foreground">latest.yml</dt>
                  <dd>Задан</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setStep(2)} disabled={upload.isPending}>
              Назад
            </Button>
            <Button type="submit" size="lg" disabled={upload.isPending || !versionReady || !fileReady || !ymlReady}>
              {upload.isPending ? <Spinner data-icon="inline-start" aria-label="Публикация" /> : null}
              Опубликовать
            </Button>
          </div>
        </div>
      ),
    },
  ];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Лаунчер</h1>
        <p className="max-w-[65ch] text-sm text-muted-foreground">
          Сервер берёт свежие исходники, подставляет эти настройки и собирает установщик Windows.
        </p>
      </header>

      {settings.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{settings.error.message}</AlertDescription>
        </Alert>
      ) : null}
      {info.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{info.error.message}</AlertDescription>
        </Alert>
      ) : null}

      <form className="grid gap-6" onSubmit={onSave}>
        <div className="grid gap-2">
          <Label htmlFor="launcher-api">Адрес API</Label>
          <Input
            id="launcher-api"
            value={apiUrl}
            placeholder="https://example.com/minecraft/api"
            onChange={(event) => setApiUrl(event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="launcher-name">Название</Label>
          <Input id="launcher-name" value={productName} onChange={(event) => setProductName(event.target.value)} />
        </div>
        {productName.trim() !== DEFAULT_PRODUCT_NAME ? (
          <Alert>
            <AlertDescription>
              Если сменить название, у игроков лаунчер создаст новую папку данных и скачает игру заново.
            </AlertDescription>
          </Alert>
        ) : null}
        <div className="grid gap-2">
          <Label htmlFor="launcher-app-id">appId</Label>
          <Input id="launcher-app-id" value={appId} onChange={(event) => setAppId(event.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="launcher-build-version">Номер сборки</Label>
          <Input
            id="launcher-build-version"
            value={version}
            placeholder="из репозитория"
            onChange={(event) => setVersion(event.target.value)}
          />
          <p className="text-sm text-muted-foreground">
            {published ? `Сейчас у игроков версия ${published}.` : "Установщик ещё не опубликован."} Оставьте поле
            пустым, чтобы взять версию из репозитория.
          </p>
        </div>
        {versionDelta !== null && versionDelta <= 0 ? (
          <Alert>
            <AlertDescription>
              Эта версия не новее уже опубликованной, поэтому игроки не получат обновление.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-2">
          <Label htmlFor="launcher-icon">Иконка PNG, от 256×256</Label>
          <Input
            id="launcher-icon"
            type="file"
            accept="image/png,.png"
            onChange={(event) => onIcon(event.target.files)}
          />
          {iconPreview ? (
            <img src={iconPreview} alt="" className="size-16 rounded-lg border border-border object-cover" />
          ) : (
            <p className="text-sm text-muted-foreground">Своя иконка не задана, в сборке останется иконка репозитория.</p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {THEME_FIELDS.map((field) => {
            const value = theme[field.token] ?? field.fallback;
            return (
              <div key={field.token} className="grid gap-2">
                <Label htmlFor={`theme-${field.token}`}>{field.label}</Label>
                <div className="flex gap-2">
                  <Input
                    aria-label={`${field.label}, выбор цвета`}
                    className="h-8 w-14 cursor-pointer p-1"
                    type="color"
                    value={pickerValue(value, field.fallback)}
                    onChange={(event) => setTheme((current) => ({ ...current, [field.token]: event.target.value }))}
                  />
                  <Input
                    id={`theme-${field.token}`}
                    value={value}
                    onChange={(event) => setTheme((current) => ({ ...current, [field.token]: event.target.value }))}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-3">
          <Button type="submit" size="lg" variant="outline" disabled={!settings.data || save.isPending || building}>
            Сохранить
          </Button>
          <Button type="button" size="lg" disabled={!settings.data || building} onClick={() => startBuild.mutate()}>
            {building ? "Сборка…" : "Запустить сборку"}
          </Button>
        </div>
      </form>

      <section className="grid gap-3">
        <h2 className="text-lg font-medium">{STATUS_LABEL[build.data?.status ?? "idle"]}</h2>
        {build.data?.version ? (
          <p className="text-sm text-muted-foreground">
            Версия {build.data.version}
            {build.data.commit ? `, коммит ${build.data.commit.slice(0, 7)}` : ""}
          </p>
        ) : null}
        {build.data?.error ? (
          <Alert variant="destructive">
            <AlertDescription>{build.data.error}</AlertDescription>
          </Alert>
        ) : null}
        {published ? (
          <a className="text-sm underline underline-offset-4" href="/minecraft/api/downloadGame.exe">
            Скачать установщик
          </a>
        ) : null}
        <pre className="max-h-80 overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap">
          {build.data?.log?.trim() || "Лог появится после запуска сборки."}
        </pre>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Загрузить вручную</h2>
        <p className="max-w-[65ch] text-sm text-muted-foreground">
          ZIP с установщиком, версия и содержимое latest.yml.
        </p>
        {info.isPending ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <form onSubmit={onSubmit}>
            <AnimatedStepper
              allowClickNavigation={false}
              currentStep={step}
              onStepChange={setStep}
              steps={steps}
              variant="horizontal"
            />
          </form>
        )}
      </section>
    </div>
  );
}

function StepActions({
  onBack,
  onNext,
  nextDisabled,
}: {
  onBack?: () => void;
  onNext: () => void;
  nextDisabled: boolean;
}) {
  return (
    <div className="flex gap-2">
      {onBack ? (
        <Button type="button" variant="outline" onClick={onBack}>
          Назад
        </Button>
      ) : null}
      <Button type="button" onClick={onNext} disabled={nextDisabled}>
        Далее
      </Button>
    </div>
  );
}
