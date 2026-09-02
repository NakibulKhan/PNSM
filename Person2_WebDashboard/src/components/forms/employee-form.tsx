/**
 * Employee onboarding form — wireframe Fig 3.5, field for field:
 * Full Name · Employee ID · Department · Shift Timing · Assigned Office
 * (Geofence) · Geofence Radius (m) · reference photo · CREATE PROFILE.
 *
 * The radius shown here is the assigned office's own radius, read from the
 * geofence record, because radius is a property of a location rather than of a
 * person. It is editable from this screen for convenience (the wireframe puts it
 * here) and writes back to the geofence.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { PhotoUpload } from './photo-upload';
import { useToast } from '@/components/ui/toast';
import { api, fetchData } from '@/api/client';
import { queryKeys } from '@/lib/query-keys';
import { employeeSchema, type EmployeeInput } from '@/schemas';
import {
  DEFAULT_GEOFENCE_RADIUS,
  MAX_GEOFENCE_RADIUS,
  MIN_GEOFENCE_RADIUS,
} from '@/lib/constants';
import type { Geofence, Office, User } from '@/types/models';

interface CreateResponse {
  employee: User;
  generated_pin: string;
}

export function EmployeeForm() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [radius, setRadius] = useState(DEFAULT_GEOFENCE_RADIUS);
  const [issuedPin, setIssuedPin] = useState<string | null>(null);

  const { data: offices } = useQuery({
    queryKey: queryKeys.offices,
    queryFn: () => fetchData<Office[]>('offices'),
    staleTime: 5 * 60_000,
  });

  const { data: geofences } = useQuery({
    queryKey: queryKeys.geofences,
    queryFn: () => fetchData<Geofence[]>('geofences'),
    staleTime: 5 * 60_000,
  });

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<EmployeeInput>({
    resolver: zodResolver(employeeSchema),
    defaultValues: {
      name: '',
      employee_code: '',
      email: '',
      phone: '',
      department: '',
      shift_start: '09:00',
      shift_end: '18:00',
      days_of_week: 'Sun-Thu',
      office_id: '',
      reference_photo_url: '',
    },
  });

  const selectedOffice = watch('office_id');
  const photoUrl = watch('reference_photo_url');

  // Radius follows the chosen office, so HR sees the value that actually applies.
  useEffect(() => {
    const fence = geofences?.find((candidate) => candidate.office_id === selectedOffice);
    if (fence) setRadius(fence.radius_meters);
  }, [selectedOffice, geofences]);

  const createEmployee = useMutation({
    mutationFn: async (values: EmployeeInput) => {
      const { data } = await api.post<CreateResponse>('employees', values);

      // Persist a changed radius against the office's geofence.
      const fence = geofences?.find((candidate) => candidate.office_id === values.office_id);
      if (fence && fence.radius_meters !== radius) {
        await api.patch(`geofences/${fence._id}`, { radius_meters: radius });
      }

      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.kpis });
      queryClient.invalidateQueries({ queryKey: queryKeys.geofences });
      setIssuedPin(data.generated_pin);
      toast({
        tone: 'success',
        title: 'Profile created',
        description: `${data.employee.name} can now check in from the mobile app.`,
      });
      reset();
    },
    onError: (error: Error) => {
      toast({ tone: 'error', title: 'Profile not created', description: error.message });
    },
  });

  return (
    <form onSubmit={handleSubmit((values) => createEmployee.mutate(values))}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader
            title="Add new employee"
            description="Creates the profile and generates the biometric baseline and 2FA PIN."
          />
          <CardBody className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" error={errors.name?.message} required>
                <Input {...register('name')} placeholder="Rafiq Hasan" invalid={!!errors.name} />
              </Field>

              <Field label="Employee ID" error={errors.employee_code?.message} required>
                <Input
                  {...register('employee_code')}
                  placeholder="PNSM-0142"
                  numeric
                  invalid={!!errors.employee_code}
                />
              </Field>

              <Field label="Work email" error={errors.email?.message} required>
                <Input
                  {...register('email')}
                  type="email"
                  placeholder="rafiq.hasan@company.com"
                  invalid={!!errors.email}
                />
              </Field>

              <Field
                label="Mobile number"
                hint="Used for the mobile app login"
                error={errors.phone?.message}
                required
              >
                <Input
                  {...register('phone')}
                  placeholder="01712345678"
                  numeric
                  invalid={!!errors.phone}
                />
              </Field>

              <Field label="Department" error={errors.department?.message} required>
                <Input {...register('department')} placeholder="Field Operations" invalid={!!errors.department} />
              </Field>

              <Field label="Working days" error={errors.days_of_week?.message} required>
                <Select {...register('days_of_week')} invalid={!!errors.days_of_week}>
                  <option value="Sun-Thu">Sunday to Thursday</option>
                  <option value="Sat-Wed">Saturday to Wednesday</option>
                  <option value="Mon-Fri">Monday to Friday</option>
                  <option value="Sun-Fri">Sunday to Friday</option>
                </Select>
              </Field>

              <Field label="Shift starts" error={errors.shift_start?.message} required>
                <Input {...register('shift_start')} type="time" numeric invalid={!!errors.shift_start} />
              </Field>

              <Field label="Shift ends" error={errors.shift_end?.message} required>
                <Input {...register('shift_end')} type="time" numeric invalid={!!errors.shift_end} />
              </Field>
            </div>

            <div className="grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
              <Field
                label="Assigned office (geofence)"
                error={errors.office_id?.message}
                hint="Check-ins are validated against this location"
                required
              >
                <Select {...register('office_id')} invalid={!!errors.office_id}>
                  <option value="">Select an office</option>
                  {offices?.map((office) => (
                    <option key={office._id} value={office._id}>
                      {office.office_name}
                    </option>
                  ))}
                </Select>
              </Field>

              <div>
                <span className="eyebrow mb-1.5 block">
                  Geofence radius <span className="tnum text-ink">{radius} m</span>
                </span>
                <Slider
                  value={radius}
                  min={MIN_GEOFENCE_RADIUS}
                  max={MAX_GEOFENCE_RADIUS}
                  step={5}
                  onValueChange={setRadius}
                  aria-label="Geofence radius in metres"
                />
                <p className="mt-1 text-[11.5px] text-faint">
                  Applies to everyone at this office. Adjust for building size or outdoor areas.
                </p>
              </div>
            </div>
          </CardBody>

          <CardFooter className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[11.5px] text-faint">
              A 2FA PIN is generated automatically and shown once after saving.
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" onClick={() => navigate('/employees')}>
                Cancel
              </Button>
              <Button type="submit" loading={isSubmitting || createEmployee.isPending}>
                <UserPlus size={14} aria-hidden />
                Create profile
              </Button>
            </div>
          </CardFooter>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardBody>
              <PhotoUpload
                value={photoUrl || null}
                error={errors.reference_photo_url?.message}
                onChange={(url) =>
                  setValue('reference_photo_url', url ?? '', { shouldValidate: true })
                }
              />
            </CardBody>
          </Card>

          {issuedPin ? (
            <Card className="border-verified/30 bg-verified-soft">
              <CardBody>
                <p className="eyebrow">2FA PIN issued</p>
                <p className="tnum mt-1 text-[30px] font-semibold leading-none text-verified">
                  {issuedPin}
                </p>
                <p className="mt-2 text-[11.5px] text-verified">
                  Give this to the employee now. It is not shown again — reissue from their profile if
                  it is lost.
                </p>
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardBody className="space-y-2">
              <p className="eyebrow">What happens on save</p>
              <ol className="space-y-1.5 text-[11.5px] text-muted">
                <li>1. The photo is compressed and stored in S3.</li>
                <li>2. The face embedding is generated for 1:1 matching.</li>
                <li>3. A 2FA PIN is issued for mobile check-in.</li>
                <li>4. The profile activates against the assigned geofence.</li>
              </ol>
            </CardBody>
          </Card>
        </div>
      </div>
    </form>
  );
}
