// Edit: <newportal>/src/app/app-provider.tsx
// Add the applicationKey prop to ShaApplicationProvider. It MUST equal the migration app_key
// and the portal folder name exactly, or the front-end will not be identified as its own app.

export const AppProvider: FC<PropsWithChildren<IAppProviderProps>> = ({
  children,
  backendUrl,
}) => {
  const nextRouter = useNextRouter();
  const theme = useTheme();

  return (
    <GlobalStateProvider>
      <AppProgressBar height="4px" color={theme.colorPrimary} shallowRouting />
      <ShaApplicationProvider
        backendUrl={backendUrl}
        router={nextRouter}
        applicationKey={"publicportal2"}   /* <-- ADD THIS; must match migration app_key */
        noAuth={nextRouter.path?.includes('/no-auth')}
      >
        <StoredFilesProvider baseUrl={backendUrl} ownerId={""} ownerType={""}>
          {children}
        </StoredFilesProvider>
      </ShaApplicationProvider>
    </GlobalStateProvider>
  );
};
