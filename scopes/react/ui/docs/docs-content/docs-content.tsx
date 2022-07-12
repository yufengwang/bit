import { ErrorBoundary } from 'react-error-boundary';
import { isFunction } from 'lodash';

import { docsFile } from '@teambit/documenter.types.docs-file';
import { ErrorFallback } from '@teambit/react.ui.error-fallback';
import { MDXLayout } from '@teambit/mdx.ui.mdx-layout';
import { SectionProps } from '@teambit/documenter.ui.section';
import React from 'react';

export interface DocsContentProps extends SectionProps {
  docs?: docsFile;
}

const defaultDocs = {
  examples: [],
  labels: [],
  abstract: '',
};

export function DocsContent({ docs = defaultDocs, ...rest }: DocsContentProps) {
  const Content: any = isFunction(docs.default) ? docs.default : () => null;

  return (
    <ErrorBoundary FallbackComponent={ErrorFallback}>
      {Content.isMDXComponent ? (
        <MDXLayout {...rest}>
          <Content />
        </MDXLayout>
      ) : (
        <Content />
      )}
    </ErrorBoundary>
  );
}